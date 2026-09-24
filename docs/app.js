const config = window.MUTUM_CONFIG;
const Cap = window.Capacitor;
const isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
// plugins nativos sem bundler: usa o proxy já criado pela ponte ou registra pelo nome
const plugin = name => (Cap.Plugins && Cap.Plugins[name]) || Cap.registerPlugin(name);

const db = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
  auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: !isNative }
});

const state = {
  session: null, profile: null,
  events: [], trades: [], transactions: [],
  tradeFilter: 'all', eventFilter: 'all', search: '',
  pendingEmail: ''
};

const errorMessages = {
  saldo_insuficiente: 'Saldo insuficiente.',
  destinatario_nao_encontrado: 'Ninguém encontrado com esse código ou e-mail.',
  transferencia_para_si: 'Você não pode transferir para você mesmo.',
  valor_invalido: 'Informe um valor válido.',
  troca_indisponivel: 'Essa troca não está mais disponível.',
  troca_propria: 'Essa oferta é sua.',
  nao_autenticado: 'Sua sessão expirou. Entre de novo.'
};
const friendlyError = err => {
  const msg = (err && err.message) || '';
  const key = Object.keys(errorMessages).find(k => msg.includes(k));
  if (key) return errorMessages[key];
  if (/fetch|network/i.test(msg)) return 'Sem conexão com a internet.';
  if (/check constraint|row-level security/i.test(msg)) return 'Confira os campos e tente de novo.';
  return msg || 'Algo deu errado. Tente de novo.';
};

const $ = (q, root = document) => root.querySelector(q);
const $$ = (q, root = document) => [...root.querySelectorAll(q)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ─── Datas ───────────────────────────────────────────────────
const MONTHS = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const dayDiff = d => Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000);

function eventPeriod(e) {
  const diff = dayDiff(new Date(e.starts_at));
  return diff === 0 ? 'today' : diff > 0 && diff <= 7 ? 'week' : 'later';
}

function eventWhen(e) {
  const d = new Date(e.starts_at); const diff = dayDiff(d);
  const hour = `${d.getHours()}H${d.getMinutes() ? String(d.getMinutes()).padStart(2, '0') : ''}`;
  const day = diff === 0 ? 'HOJE' : diff === 1 ? 'AMANHÃ' : `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]}`;
  return `${day} · ${hour}`;
}

function transactionDate(iso) {
  const d = new Date(iso); const diff = dayDiff(d);
  if (diff === 0) return `Hoje · ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  if (diff === -1) return 'Ontem';
  return `${d.getDate()} ${MONTHS[d.getMonth()].toLowerCase()}`;
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Boa noite,' : h < 12 ? 'Bom dia,' : h < 18 ? 'Boa tarde,' : 'Boa noite,';
}

// ─── Carregamento de dados ───────────────────────────────────
async function loadProfile() {
  const { data, error } = await db.from('profiles').select('*').eq('id', state.session.user.id).single();
  if (error) throw error;
  state.profile = data;
}

async function loadEvents() {
  const since = startOfDay(new Date()).toISOString();
  const { data, error } = await db.from('event_summary').select('*').gte('starts_at', since).order('starts_at');
  if (error) throw error;
  state.events = data;
}

async function loadTrades() {
  const { data, error } = await db.from('trades').select('*').order('id');
  if (error) throw error;
  state.trades = data;
}

async function loadTransactions() {
  const { data, error } = await db.from('transactions').select('*').order('created_at', { ascending: false }).limit(50);
  if (error) throw error;
  state.transactions = data;
}

async function loadAll() {
  try {
    await Promise.all([loadProfile(), loadEvents(), loadTrades(), loadTransactions()]);
    render();
  } catch (err) {
    toast(friendlyError(err));
  }
}

// ─── Telas ───────────────────────────────────────────────────
function showLogin() {
  $('#main-screen').hidden = true; $('#login-screen').hidden = false;
  setLoginStep('email');
}

async function showApp() {
  $('#login-screen').hidden = true; $('#main-screen').hidden = false;
  $('#greeting').textContent = greeting();
  await loadAll();
}

function setLoginStep(step) {
  $('#email-step').hidden = step !== 'email';
  $('#code-step').hidden = step !== 'code';
  $('#login-note').textContent = step === 'code'
    ? 'Toque no link do e-mail neste celular, ou digite o código se ele vier no e-mail. Confira também o spam.'
    : 'Enviamos um código para o seu e-mail. Sem senha.';
  if (step === 'code') { $('#otp-email').textContent = state.pendingEmail; $('#otp').value = ''; $('#otp').focus(); }
}

const priceLabel = t => `${t.price} MTR / ${esc(t.unit)}`;

function render() {
  const p = state.profile;
  if (p) {
    const initial = (p.name || '?')[0].toUpperCase();
    $('#user-name').textContent = p.name; $('#profile-name').textContent = p.name;
    $('#profile-email').textContent = p.email;
    $('#nav-avatar').textContent = initial; $('#profile-avatar').textContent = initial;
    $('#balance-home').textContent = p.balance; $('#balance-wallet').textContent = p.balance;
    $('#balance-brl').textContent = p.balance;
  }

  const uid = state.session && state.session.user.id;
  const ownerTag = (mine, label = 'SUA') => mine ? `<span class="owner-tag">${label}</span>` : '';
  const activeTrades = state.trades.filter(t => t.active);
  $('#home-trades').innerHTML = activeTrades.length
    ? activeTrades.slice(0, 4).map(t => `<button class="mini-trade" data-trade="${t.id}"><div class="trade-icon">${esc(t.icon)}</div><h3>${esc(t.title)}</h3><p>${esc(t.by_name)}</p><strong>${priceLabel(t)}</strong></button>`).join('')
    : '<div class="empty-state">Nenhuma troca oferecida ainda. <button class="section-link" data-go="trocas" type="button">Ofereça a primeira</button></div>';

  const visibleTrades = state.trades.filter(t => (state.tradeFilter === 'all' || (state.tradeFilter === 'mine' ? t.owner_id === uid : t.category === state.tradeFilter)) && (t.active || t.owner_id === uid) && `${t.title} ${t.by_name}`.toLowerCase().includes(state.search));
  $('#trades-list').innerHTML = visibleTrades.length
    ? visibleTrades.map(t => `<article class="trade-card"><div class="trade-icon">${esc(t.icon)}</div><h3>${esc(t.title)}${ownerTag(t.owner_id === uid)}</h3><p>${esc(t.by_name)}</p><footer><strong>${priceLabel(t)}</strong><button data-trade="${t.id}" aria-label="Ver oferta">→</button></footer></article>`).join('')
    : `<div class="empty-state">${state.trades.length ? 'Nenhuma troca encontrada.' : 'Ninguém ofereceu trocas ainda. Que tal ser a primeira pessoa?'}</div>`;

  const visibleEvents = state.events.filter(e => { const period = eventPeriod(e); return state.eventFilter === 'all' || (state.eventFilter === 'mine' ? e.mine || e.joined : period === state.eventFilter || (state.eventFilter === 'week' && period === 'today')); });
  $('#events-list').innerHTML = visibleEvents.length
    ? visibleEvents.map(e => { const d = new Date(e.starts_at); const action = e.mine
        ? `<button class="small-action danger" data-delete-event="${e.id}">Excluir</button>`
        : `<button class="small-action ${e.joined ? 'joined' : ''}" data-join="${e.id}">${e.joined ? 'Cancelar presença' : 'Quero ir'}</button>`;
      return `<article class="event-card"><div class="date-box"><b>${String(d.getDate()).padStart(2, '0')}</b><span>${MONTHS[d.getMonth()]}</span></div><div><h3>${esc(e.title)}${ownerTag(e.mine, 'SEU')}</h3><p class="organizer">${eventWhen(e)} · por ${esc(e.created_by_name || 'alguém')} · ${e.participants} ${e.participants === 1 ? 'confirmado' : 'confirmados'}</p><p>${esc(e.description)}</p><footer><span>⌖ ${esc(e.place)}</span>${action}</footer></div></article>`; }).join('')
    : `<div class="empty-state">${state.events.length ? 'Nenhum mutirão neste filtro.' : 'Nenhum mutirão marcado ainda. Crie o primeiro!'}</div>`;

  $('#transactions-list').innerHTML = state.transactions.length
    ? state.transactions.map(t => `<div class="transaction"><div class="transaction-icon">${esc(t.icon)}</div><div class="transaction-copy"><b>${esc(t.title)}</b><small>${transactionDate(t.created_at)}</small></div><strong class="${t.value >= 0 ? 'positive' : 'negative'}">${t.value >= 0 ? '+' : '−'}${Math.abs(t.value)} MTR</strong></div>`).join('')
    : '<div class="empty-state">Nenhuma movimentação ainda.</div>';

  const featured = state.events[0];
  $('#featured-event').hidden = !featured;
  $('#featured-empty').hidden = !!featured;
  if (featured) {
    $('#featured-when').textContent = eventWhen(featured);
    $('#featured-place').textContent = featured.place.toUpperCase();
    $('#featured-title').textContent = featured.title;
    $('#featured-text').textContent = featured.description;
    $('#featured-count').textContent = `${featured.participants} ${featured.participants === 1 ? 'pessoa' : 'pessoas'}`;
    const fj = $('#featured-join');
    delete fj.dataset.join; delete fj.dataset.go;
    if (featured.mine) { fj.dataset.go = 'mutiroes'; fj.textContent = 'Você organiza este mutirão'; }
    else { fj.dataset.join = featured.id; fj.textContent = featured.joined ? 'Cancelar participação' : 'Participar deste mutirão'; }
  }

  const stats = $$('.profile-stats b');
  if (stats.length && p) {
    stats[0].textContent = state.events.filter(e => e.joined).length;
    stats[1].textContent = state.transactions.filter(t => t.kind === 'trade' || t.kind === 'sale').length;
    stats[2].textContent = p.balance;
  }
}

function navigate(view) {
  $$('.view').forEach(v => v.classList.toggle('active', v.dataset.view === view));
  $$('.bottom-nav button').forEach(b => b.classList.toggle('active', b.dataset.go === view));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toast(message) {
  const el = $('#toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2600);
}

let dialogAction = null;
function modal(title, copy, icon = '✓', actionLabel = 'Entendi', action = null) {
  $('#dialog-title').textContent = title; $('#dialog-copy').textContent = copy; $('#dialog-icon').textContent = icon;
  $('#dialog-primary').textContent = actionLabel; dialogAction = action; $('#action-dialog').showModal();
}

// ─── Ações ───────────────────────────────────────────────────
function openTrade(id) {
  const t = state.trades.find(x => x.id === id); if (!t) return;
  if (t.owner_id === state.session.user.id) {
    modal(t.title, `Esta é a sua oferta: ${t.price} MTR / ${t.unit}. Quando alguém contratar, o valor entra no seu saldo.`, t.icon, 'Remover oferta', () => {
      modal('Remover oferta?', `“${t.title}” deixa de aparecer para a rede.`, '!', 'Sim, remover', async () => {
        const { error } = await db.from('trades').delete().eq('id', t.id);
        if (error) { toast(friendlyError(error)); return; }
        await loadTrades(); render(); toast('Oferta removida');
      });
    });
    return;
  }
  modal(t.title, `${t.description} ${t.by_name} oferece por ${t.price} MTR / ${t.unit}. Seu saldo é ${state.profile.balance} MTR.`, t.icon, `Contratar por ${t.price} MTR`, async () => {
    if (state.profile.balance < t.price) { modal('Saldo insuficiente', `Você precisa de ${t.price - state.profile.balance} MTR a mais para esta troca.`, '!'); return; }
    const { error } = await db.rpc('buy_trade', { p_trade_id: t.id });
    if (error) { toast(friendlyError(error)); return; }
    await Promise.all([loadProfile(), loadTransactions()]); render();
    toast('Troca confirmada e saldo atualizado');
  });
}

async function toggleEvent(id) {
  const event = state.events.find(x => x.id === id); if (!event) return;
  const { error } = event.joined
    ? await db.from('event_participants').delete().match({ event_id: id, user_id: state.session.user.id })
    : await db.from('event_participants').insert({ event_id: id });
  if (error) { toast(friendlyError(error)); return; }
  await loadEvents(); render();
  if (event.joined) toast('Participação cancelada');
  else modal('Presença confirmada!', `Você entrou no mutirão “${event.title}”. Nos vemos lá!`, '♧');
}

function deleteEvent(id) {
  const event = state.events.find(x => x.id === id); if (!event) return;
  const who = event.participants ? ` ${event.participants} ${event.participants === 1 ? 'pessoa confirmada perde' : 'pessoas confirmadas perdem'} a presença.` : '';
  modal('Excluir mutirão?', `“${event.title}” some da lista de todo mundo.${who}`, '!', 'Sim, excluir', async () => {
    const { data, error } = await db.from('events').delete().eq('id', id).select('id');
    if (error || !data.length) { toast(error ? friendlyError(error) : 'Não foi possível excluir'); return; }
    await loadEvents(); render(); toast('Mutirão excluído');
  });
}

const TRADE_ICONS = ['⇄', '♧', '✿', '⚙', '✂', '⌁', '◒', '✎', '♫', '☼', '⌂', '✚'];
let tradeIcon = TRADE_ICONS[0];
function renderIconPicker() {
  $('#trade-icon-picker').innerHTML = TRADE_ICONS.map(i => `<button type="button" data-icon="${i}" class="${i === tradeIcon ? 'active' : ''}">${i}</button>`).join('');
}

function localDateTimeValue(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function withSubmit(form, fn) {
  const submit = $('[type=submit]', form); submit.disabled = true;
  try { await fn(); } finally { submit.disabled = false; }
}

async function signInWithGoogle() {
  if (!isNative) {
    const { error } = await db.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
    if (error) toast(friendlyError(error));
    return;
  }
  const { data, error } = await db.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: config.nativeRedirectUrl, skipBrowserRedirect: true } });
  if (error) { toast(friendlyError(error)); return; }
  await plugin('Browser').open({ url: data.url });
}

if (isNative) {
  plugin('App').addListener('appUrlOpen', async ({ url }) => {
    if (!url.startsWith(config.nativeRedirectUrl)) return;
    try { await plugin('Browser').close(); } catch { /* já fechado */ }
    const params = new URL(url).searchParams;
    const code = params.get('code');
    if (!code) { toast(params.get('error_description') || 'Login cancelado'); return; }
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (error) toast(friendlyError(error));
  });
}

// ─── Eventos de interface ────────────────────────────────────
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const buttons = $$('#login-form button'); buttons.forEach(b => b.disabled = true);
  try {
    if (!$('#email-step').hidden) {
      const email = $('#email').value.trim().toLowerCase();
      const emailRedirectTo = isNative ? config.nativeRedirectUrl : location.origin + location.pathname;
      const { error } = await db.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo } });
      if (error) throw error;
      state.pendingEmail = email; setLoginStep('code');
    } else {
      const token = $('#otp').value.replace(/\D/g, '');
      if (token.length < 6) { toast('Digite o código completo'); return; }
      const { error } = await db.auth.verifyOtp({ email: state.pendingEmail, token, type: 'email' });
      if (error) throw error;
    }
  } catch (err) {
    toast(/expired|invalid/i.test(err.message) ? 'Código inválido ou expirado' : friendlyError(err));
  } finally {
    buttons.forEach(b => b.disabled = false);
  }
});

$('#back-to-email').addEventListener('click', () => setLoginStep('email'));
$('#google-button').addEventListener('click', signInWithGoogle);

document.addEventListener('click', e => {
  const go = e.target.closest('[data-go]'); if (go) navigate(go.dataset.go);
  const join = e.target.closest('[data-join]'); if (join) toggleEvent(Number(join.dataset.join));
  const trade = e.target.closest('[data-trade]'); if (trade) openTrade(Number(trade.dataset.trade));
  const del = e.target.closest('[data-delete-event]'); if (del) deleteEvent(Number(del.dataset.deleteEvent));
  const close = e.target.closest('[data-close]'); if (close) $(`#${close.dataset.close}`).close();
  const icon = e.target.closest('[data-icon]'); if (icon) { tradeIcon = icon.dataset.icon; renderIconPicker(); }
  const chip = e.target.closest('.chip[data-filter]');
  if (chip) {
    const row = chip.closest('[data-filter-group]'); $$('.chip', row).forEach(x => x.classList.remove('active')); chip.classList.add('active');
    if (row.dataset.filterGroup === 'events') state.eventFilter = chip.dataset.filter; else state.tradeFilter = chip.dataset.filter;
    render();
  }
});

$('#dialog-primary').addEventListener('click', () => { $('#action-dialog').close(); const action = dialogAction; dialogAction = null; if (action) action(); });
$('#trade-search').addEventListener('input', e => { state.search = e.target.value.trim().toLowerCase(); render(); });
$('#profile-button').addEventListener('click', () => $('#profile-dialog').showModal());
$('[data-close-profile]').addEventListener('click', () => $('#profile-dialog').close());
$('#logout-button').addEventListener('click', async () => { $('#profile-dialog').close(); await db.auth.signOut(); $('#email').value = ''; });

$('#receive-button').addEventListener('click', () => { $('#receive-code').textContent = state.profile ? state.profile.receive_code : '—'; $('#receive-dialog').showModal(); });
$('[data-close-receive]').addEventListener('click', () => $('#receive-dialog').close());
$('#copy-code-button').addEventListener('click', async () => { const code = $('#receive-code').textContent; try { await navigator.clipboard.writeText(code); toast('Código copiado'); } catch { toast(`Código: ${code}`); } });
$('#send-button').addEventListener('click', () => { $('#transfer-form').reset(); $('#transfer-dialog').showModal(); });
$('[data-close-transfer]').addEventListener('click', () => $('#transfer-dialog').close());
$('#transfer-form').addEventListener('submit', async e => {
  e.preventDefault(); const to = $('#transfer-to').value.trim(); const amount = Math.floor(Number($('#transfer-amount').value));
  if (!to || !Number.isFinite(amount) || amount < 1) { toast('Preencha o destinatário e um valor válido'); return; }
  if (amount > state.profile.balance) { toast('Saldo insuficiente para transferir'); return; }
  const submit = $('#transfer-form [type=submit]'); submit.disabled = true;
  const { error } = await db.rpc('transfer_mtr', { p_to: to, p_amount: amount, p_note: $('#transfer-note').value });
  submit.disabled = false;
  if (error) { toast(friendlyError(error)); return; }
  $('#transfer-dialog').close();
  await Promise.all([loadProfile(), loadTransactions()]); render();
  modal('Transferência concluída', `${amount} MTR foram enviados para ${to}.`, '✓');
});
$('#statement-button').addEventListener('click', async () => {
  // soma feita no servidor: a lista na tela só traz as últimas 50 movimentações
  const { data, error } = await db.rpc('wallet_summary');
  if (error) { toast(friendlyError(error)); return; }
  const s = data[0];
  modal('Resumo do extrato', `Entradas: ${s.incoming} MTR · Saídas: ${s.outgoing} MTR · Saldo atual: ${s.balance} MTR.`, '≡');
});

$('#new-event-button').addEventListener('click', () => {
  $('#event-form').reset();
  const suggestion = new Date(Date.now() + 86400000); suggestion.setHours(9, 0, 0, 0);
  $('#event-when').value = localDateTimeValue(suggestion);
  $('#event-when').min = localDateTimeValue(new Date());
  $('#event-dialog').showModal();
});
$('#event-form').addEventListener('submit', e => { e.preventDefault(); withSubmit(e.target, async () => {
  const startsAt = new Date($('#event-when').value);
  if (Number.isNaN(startsAt.getTime()) || startsAt < new Date(Date.now() - 3600000)) { toast('Escolha uma data futura'); return; }
  const { error } = await db.from('events').insert({
    title: $('#event-title').value.trim(), place: $('#event-place').value.trim(),
    description: $('#event-description').value.trim(), starts_at: startsAt.toISOString()
  });
  if (error) { toast(friendlyError(error)); return; }
  $('#event-dialog').close(); await loadEvents(); render(); toast('Mutirão publicado');
}); });

$('#new-trade-button').addEventListener('click', () => { $('#trade-form').reset(); tradeIcon = TRADE_ICONS[0]; renderIconPicker(); $('#trade-dialog').showModal(); });
$('#trade-form').addEventListener('submit', e => { e.preventDefault(); withSubmit(e.target, async () => {
  const price = Math.floor(Number($('#trade-price').value));
  if (!Number.isFinite(price) || price < 1 || price > 10000) { toast('Valor entre 1 e 10.000 MTR'); return; }
  const { error } = await db.from('trades').insert({
    icon: tradeIcon, title: $('#trade-title').value.trim(), category: $('#trade-category').value,
    price, unit: $('#trade-unit').value.trim(), description: $('#trade-description').value.trim()
  });
  if (error) { toast(friendlyError(error)); return; }
  $('#trade-dialog').close(); await loadTrades(); render(); toast('Oferta publicada');
}); });

// ─── Sininho de atualização ──────────────────────────────────
// Duas camadas, as duas lidas do mesmo version.json publicado:
// 1) Interface (APK e navegador): o publish.mjs carimba index.html com <meta name="mutum-build"> e
//    os arquivos com ?v=<build>. Se o version.json tiver um build diferente, a página recarrega
//    buscando a versão nova (nunca com diálogo aberto, uma tentativa por build).
// 2) Sininho (só APK): compara o versionName instalado com androidVersion. Só muda quando sai
//    APK novo (mudança nativa).
const BUILD = (document.querySelector('meta[name="mutum-build"]') || {}).content || '';
let pendingUpdate = null;
let pendingReload = null;

function reloadToBuild(build) {
  if (document.querySelector('dialog[open]')) { pendingReload = build; return; }
  const key = `mutum-reload-${build}`;
  try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch { /* sem storage: segue */ }
  const url = new URL(location.href); url.searchParams.set('v', build);
  location.replace(url.href);
}

// ao fechar qualquer diálogo, aplica o recarregamento que ficou esperando
document.addEventListener('close', () => { if (pendingReload && !document.querySelector('dialog[open]')) reloadToBuild(pendingReload); }, true);

function isVersionNewer(remote, current) {
  const parts = v => String(v).trim().replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  const r = parts(remote), c = parts(current);
  for (let i = 0; i < Math.max(r.length, c.length); i += 1) {
    if ((r[i] || 0) !== (c[i] || 0)) return (r[i] || 0) > (c[i] || 0);
  }
  return false;
}

async function checkForUpdate() {
  if (location.protocol === 'file:') return;
  let data;
  const versionUrl = new URL('version.json', location.href);
  try {
    const res = await fetch(`${versionUrl.href}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    data = await res.json();
  } catch { return; }

  // interface desatualizada? (não recarrega no meio do retorno de login com ?code=)
  if (BUILD && data.version && data.version !== BUILD && !new URLSearchParams(location.search).has('code')) reloadToBuild(data.version);

  if (!isNative) return;
  try {
    const installed = (await plugin('App').getInfo()).version;
    pendingUpdate = data.androidVersion && isVersionNewer(data.androidVersion, installed)
      ? { version: data.androidVersion, url: new URL(data.apkUrl || 'Mutum.apk', versionUrl).href }
      : null;
  } catch { pendingUpdate = null; }
  $('#update-dot').hidden = !pendingUpdate;
}

$('#update-button').addEventListener('click', () => {
  if (!pendingUpdate) { modal('Tudo em dia', isNative ? 'Você está com a versão mais recente do Mutum.' : 'No navegador o Mutum já está sempre na versão mais recente.', '✓'); return; }
  modal('Nova versão do Mutum', `A versão ${pendingUpdate.version} está disponível. O download começa agora e o Android pede para confirmar a instalação.`, '↓', 'Baixar e instalar', async () => {
    toast('Baixando atualização…');
    try { await plugin('AppUpdate').downloadAndInstall({ url: pendingUpdate.url }); }
    catch { toast('Não foi possível baixar. Tente de novo.'); }
  });
});

checkForUpdate();
setInterval(checkForUpdate, 10 * 60 * 1000);
if (isNative) plugin('App').addListener('resume', checkForUpdate);
else document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(); });

// ─── Sessão ──────────────────────────────────────────────────
db.auth.onAuthStateChange((event, session) => {
  const wasLoggedIn = !!state.session;
  state.session = session;
  if (!session) { state.profile = null; showLogin(); return; }
  // callbacks do onAuthStateChange não podem aguardar chamadas ao Supabase diretamente
  if (!wasLoggedIn || event === 'SIGNED_IN') setTimeout(() => { showApp(); navigate('home'); }, 0);
});
