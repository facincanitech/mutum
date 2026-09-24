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
  events: [], trades: [], transactions: [], urgencies: [], orders: [],
  rules: null,
  tradeFilter: 'all', eventFilter: 'all', search: ''
};

const errorMessages = {
  saldo_insuficiente: 'Saldo insuficiente.',
  destinatario_nao_encontrado: 'Ninguém encontrado com esse código.',
  transferencia_para_si: 'Você não pode pagar a você mesmo.',
  valor_invalido: 'Informe um valor válido.',
  troca_indisponivel: 'Essa troca não está mais disponível.',
  troca_propria: 'Essa oferta é sua.',
  nao_autenticado: 'Sua sessão expirou. Entre de novo.',
  codigo_invalido: 'QR ou código inválido. Peça para mostrar o QR de novo.',
  muitas_tentativas: 'Muitas tentativas erradas. Espere 10 minutos.',
  fora_do_horario: 'A presença só pode ser confirmada perto do horário do mutirão.',
  presenca_ja_confirmada: 'Sua presença já está confirmada.',
  organizador_nao_confirma: 'Quem organiza não confirma presença no próprio mutirão.',
  mutirao_encerrado: 'Esse mutirão já foi encerrado.',
  mutirao_nao_comecou: 'O mutirão ainda não começou.',
  mutirao_inexistente: 'Mutirão não encontrado.',
  sem_permissao: 'Você não tem permissão para isso.',
  pedido_invalido: 'Esse pedido não está mais aguardando pagamento.',
  urgencia_indisponivel: 'Essa urgência não está mais disponível.',
  urgencias_demais: 'Você já tem 2 urgências abertas.',
  ja_ajudando: 'Você já está ajudando em outra urgência.',
  conta_nova_transferencia: 'Contas com menos de 7 dias ainda não podem transferir.',
  limite_diario_transferencia: 'Limite de 50 MTR em transferências por dia.',
  data_passada: 'Escolha uma data futura.',
  mutirao_com_presencas: 'Mutirão com presenças confirmadas não pode ser excluído. Encerre para pagar ou devolver.'
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

async function loadUrgencies() {
  const { data, error } = await db.from('urgency_feed').select('*').order('created_at', { ascending: false }).limit(50);
  if (error) throw error;
  state.urgencies = data;
}

async function loadOrders() {
  const { data, error } = await db.from('trade_orders').select('*').order('created_at', { ascending: false }).limit(30);
  if (error) throw error;
  state.orders = data;
}

async function loadRules() {
  if (state.rules) return;
  const { data, error } = await db.rpc('get_rules');
  if (error) throw error;
  state.rules = data;
}

async function loadAll() {
  try {
    // libera pedidos vencidos, expira urgências e fecha mutirões antigos (idempotente)
    await db.rpc('housekeeping');
    await Promise.all([loadRules(), loadProfile(), loadEvents(), loadTrades(), loadTransactions(), loadUrgencies(), loadOrders()]);
    render();
  } catch (err) {
    toast(friendlyError(err));
  }
}

// ─── Telas ───────────────────────────────────────────────────
function showLogin() {
  $('#main-screen').hidden = true; $('#login-screen').hidden = false;
}

async function showApp() {
  $('#login-screen').hidden = true; $('#main-screen').hidden = false;
  $('#greeting').textContent = greeting();
  await loadAll();
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
    $('#balance-home').classList.toggle('negative-balance', p.balance < 0);
    $('#balance-wallet').classList.toggle('negative-balance', p.balance < 0);
    $('#balance-hint').textContent = p.balance < 0
      ? `Você está devendo ${-p.balance} MTR à rede. Ajude em mutirões, trocas e urgências para voltar ao positivo.`
      : 'Ganhe MTR ajudando em mutirões, trocas e urgências';
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
    ? visibleEvents.map(e => { const d = new Date(e.starts_at);
      return `<article class="event-card"><div class="date-box"><b>${String(d.getDate()).padStart(2, '0')}</b><span>${MONTHS[d.getMonth()]}</span></div><div><h3>${esc(e.title)}${ownerTag(e.mine, 'SEU')}</h3><p class="organizer">${eventWhen(e)} · por ${esc(e.created_by_name || 'alguém')} · ${e.participants} ${e.participants === 1 ? 'vai' : 'vão'} · ${e.checkins} ${e.checkins === 1 ? 'presença' : 'presenças'}</p><p>${esc(e.description)}</p><footer><span>⌖ ${esc(e.place)}</span></footer><div class="card-actions">${eventActions(e)}</div></div></article>`; }).join('')
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

  renderUrgencies();
  renderOrders();
  renderRules();

  const stats = $$('.profile-stats b');
  if (stats.length && p) {
    stats[0].textContent = state.transactions.filter(t => t.kind === 'mutirao' || t.kind === 'mutirao_hold').length;
    stats[1].textContent = state.transactions.filter(t => ['trade', 'sale', 'urgency_paid'].includes(t.kind)).length;
    stats[2].textContent = p.balance;
  }
}

const rule = key => (state.rules ? state.rules[key] : 0);
const minutes = n => n * 60000;

// o que cada pessoa pode fazer em um mutirão, conforme o momento
function eventActions(e) {
  const start = new Date(e.starts_at).getTime(), now = Date.now();
  const checkinOpen = now >= start - minutes(rule('checkin_before_min')) && now <= start + minutes(rule('checkin_after_hours') * 60);
  const rewardPill = e.reward_total ? `<span class="status-pill ok">PAGA ${e.reward_total} MTR DIVIDIDOS ENTRE QUEM FOR</span><br>` : '<span class="status-pill">VOLUNTÁRIO</span><br>';
  const report = e.mine ? '' : `<span class="spacer"></span><button class="link-action" data-report="event:${e.id}">Denunciar</button>`;
  if (e.closed_at) {
    const text = e.paid ? `ENCERRADO · PAGOU ${e.paid_total} MTR (${e.paid_each} CADA)` : e.reward_total ? `ENCERRADO · MENOS DE ${rule('mutirao_min_people')} PRESENÇAS, VALOR DEVOLVIDO` : 'ENCERRADO · VOLUNTÁRIO';
    return `<span class="status-pill ${e.paid ? 'ok' : ''}">${text}</span>`;
  }
  if (e.mine) {
    const parts = [];
    if (checkinOpen) parts.push(`<button class="small-action" data-event-qr="${e.id}">Mostrar QR de presença</button>`);
    if (now >= start) parts.push(`<button class="small-action joined" data-close-event="${e.id}">Encerrar e pagar</button>`);
    if (!e.checkins && now < start) parts.push(`<button class="small-action danger" data-delete-event="${e.id}">Excluir</button>`);
    return rewardPill + parts.join('');
  }
  if (e.checked_in) return `${rewardPill}<span class="status-pill ok">PRESENÇA CONFIRMADA</span>${report}`;
  const join = `<button class="small-action ${e.joined ? 'joined' : ''}" data-join="${e.id}">${e.joined ? 'Não vou mais' : 'Quero ir'}</button>`;
  const scan = checkinOpen ? `<button class="small-action" data-event-scan="${e.id}">Estou aqui: escanear QR</button>` : '';
  return rewardPill + scan + join + report;
}

function urgencyCard(u) {
  const when = transactionDate(u.created_at);
  const reward = `<div class="reward">${u.reward} <small>MTR</small></div>`;
  const desc = u.description ? `<p>${esc(u.description)}</p>` : '';
  const where = u.place ? `<div class="where">⌖ ${esc(u.place)}</div>` : '';
  let pill = '', actions = '';
  if (u.mine) {
    if (u.status === 'open') { pill = '<span class="status-pill warn">ESPERANDO ALGUÉM ACEITAR</span>'; actions = `<button class="small-action danger" data-urgency-cancel="${u.id}">Cancelar e devolver</button>`; }
    if (u.status === 'accepted') { pill = `<span class="status-pill ok">${esc(u.helper_name)} ESTÁ INDO</span>`; actions = `<button class="small-action" data-urgency-qr="${u.id}">Resolveu? Mostrar QR para pagar</button><button class="small-action joined" data-urgency-release="${u.id}">Liberar para outra pessoa</button><button class="small-action danger" data-urgency-cancel="${u.id}">Cancelar</button>`; }
  } else if (u.helping) {
    pill = `<span class="status-pill ok">VOCÊ ACEITOU · ${esc(u.requester_name)} ESPERA</span>`;
    actions = `<button class="small-action" data-urgency-scan="${u.id}">Resolvi: escanear QR e receber</button><button class="small-action joined" data-urgency-release="${u.id}">Desistir</button>`;
  } else {
    actions = `<button class="small-action" data-urgency-accept="${u.id}">Posso ajudar</button><span class="spacer"></span><button class="link-action" data-report="urgency:${u.id}">Denunciar</button>`;
  }
  return `<article class="info-card">${pill}<div style="display:flex;justify-content:space-between;gap:10px"><div><h3>${esc(u.title)}</h3><p>${u.mine ? 'Seu pedido' : `Pedido de ${esc(u.requester_name)}`} · ${when}</p></div>${reward}</div>${desc}${where}<div class="card-actions">${actions}</div></article>`;
}

function renderUrgencies() {
  const active = state.urgencies.filter(u => (u.mine || u.helping) && ['open', 'accepted'].includes(u.status));
  const open = state.urgencies.filter(u => !u.mine && !u.helping && u.status === 'open');
  $('#my-urgencies').innerHTML = active.map(urgencyCard).join('');
  $('#open-urgencies').innerHTML = open.length ? open.map(urgencyCard).join('') : '<div class="empty-state">Nenhum pedido aberto agora. Bom sinal!</div>';
  const mineWaiting = active.find(u => u.mine);
  $('#urgent-banner-title').textContent = active.length ? 'Você tem uma urgência em andamento' : open.length ? `${open.length} ${open.length === 1 ? 'vizinho precisa' : 'vizinhos precisam'} de ajuda` : 'Precisa de ajuda agora?';
  $('#urgent-banner-copy').textContent = mineWaiting ? (mineWaiting.status === 'accepted' ? `${mineWaiting.helper_name} aceitou o seu pedido` : 'Esperando alguém aceitar') : open.length ? 'Toque para ver e ajudar' : 'Peça uma urgência para a vizinhança';
}

function renderOrders() {
  const uid = state.session.user.id;
  const pending = state.orders.filter(o => ['held', 'disputed'].includes(o.status));
  $('#orders-block').hidden = !pending.length;
  $('#orders-list').innerHTML = pending.map(o => {
    const buyer = o.buyer_id === uid;
    const until = new Date(o.release_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    const pill = o.status === 'disputed' ? '<span class="status-pill warn">EM RECLAMAÇÃO</span>' : `<span class="status-pill">RESERVADO · LIBERA SOZINHO EM ${until}</span>`;
    const actions = buyer
      ? `<button class="small-action" data-order-qr="${o.id}">Recebi: mostrar QR</button>${o.status === 'held' ? `<button class="small-action danger" data-order-dispute="${o.id}">Reclamar</button>` : ''}`
      : `<button class="small-action" data-order-scan="${o.id}">Entreguei: escanear QR</button><button class="small-action danger" data-order-refund="${o.id}">Devolver</button>`;
    return `<article class="info-card">${pill}<div style="display:flex;justify-content:space-between;gap:10px"><div><h3>${esc(o.title)}</h3><p>${buyer ? `Você contratou de ${esc(o.seller_name)}` : `${esc(o.buyer_name)} contratou de você`}</p></div><div class="reward">${o.price} <small>MTR</small></div></div><div class="card-actions">${actions}</div></article>`;
  }).join('');
}

function renderRules() {
  if (!state.rules) return;
  $('#rules-card').innerHTML = `<b>Como funciona a moeda</b><br>
    O app não cria MTR: todo MTR sai da carteira de alguém, e todo mundo começa com 0. Quem organiza um mutirão pode prometer um valor, que sai da própria carteira e é dividido igualmente entre quem confirmar presença por QR (mínimo ${rule('mutirao_min_people')} pessoas, senão volta).
    Contas com mais de ${rule('credit_min_account_days')} dias podem ficar até −${rule('credit_limit')} MTR para pagar mutirões e urgências. Todo pagamento é por QR; nas trocas o valor fica reservado até o QR ser escaneado (ou libera sozinho em ${rule('escrow_days')} dias).`;
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
  modal(t.title, `${t.description ? t.description + ' ' : ''}${t.by_name} oferece por ${t.price} MTR / ${t.unit}. O valor fica reservado e só vai para ${t.by_name} quando você mostrar seu QR na entrega. Seu saldo: ${state.profile.balance} MTR.`, t.icon, `Contratar por ${t.price} MTR`, async () => {
    if (state.profile.balance < t.price) { modal('Saldo insuficiente', `Você precisa de ${t.price - state.profile.balance} MTR a mais. Participe de mutirões para ganhar MTR.`, '!'); return; }
    const { error } = await db.rpc('buy_trade', { p_trade_id: t.id });
    if (error) { toast(friendlyError(error)); return; }
    await Promise.all([loadProfile(), loadTransactions(), loadOrders()]); render();
    modal('Pagamento reservado', `Combine com ${t.by_name}. Na entrega, abra Carteira → Pedidos e mostre seu QR. Se você não mostrar nem reclamar em ${rule('escrow_days')} dias, o valor é liberado sozinho.`, '⇄');
  });
}

// ─── QR: mostrar ─────────────────────────────────────────────
// Conteúdo: mutum:<tipo>:<id>:<código de 6 dígitos que muda a cada 30 s>  |  mutum:pay:<MUTUM-XXXXXX>
const qrSvg = text => { const qr = qrcode(0, 'M'); qr.addData(text); qr.make(); return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); };

let qrTimer = null, qrPoll = null;
function stopQr() { clearTimeout(qrTimer); clearInterval(qrPoll); qrTimer = qrPoll = null; }
$('#qr-dialog').addEventListener('close', stopQr);

// fetchCode → { code, seconds_left } ; isDone → true quando o outro lado já escaneou
function showRotatingQr({ title, copy, foot, type, id, fetchCode, isDone, onDone }) {
  stopQr();
  $('#qr-title').textContent = title; $('#qr-copy').textContent = copy; $('#qr-foot').textContent = foot || 'O QR muda a cada 30 segundos. Print não funciona.';
  $('#qr-box').innerHTML = '<p class="form-hint">Gerando…</p>'; $('#qr-code-text').textContent = '';
  if (!$('#qr-dialog').open) $('#qr-dialog').showModal();
  const window = rule('code_window_sec') || 30;
  const refresh = async () => {
    const { data, error } = await fetchCode();
    if (error) { $('#qr-dialog').close(); toast(friendlyError(error)); return; }
    $('#qr-box').innerHTML = qrSvg(`mutum:${type}:${id}:${data.code}`);
    $('#qr-code-text').textContent = `${data.code.slice(0, 3)} ${data.code.slice(3)}`;
    const bar = $('#qr-timer-bar'); bar.style.transition = 'none'; bar.style.width = `${(data.seconds_left / window) * 100}%`;
    requestAnimationFrame(() => { bar.style.transition = `width ${data.seconds_left}s linear`; bar.style.width = '0%'; });
    qrTimer = setTimeout(refresh, data.seconds_left * 1000 + 300);
  };
  refresh();
  if (isDone) qrPoll = setInterval(async () => { if (await isDone()) { $('#qr-dialog').close(); onDone && onDone(); } }, 3000);
}

// ─── QR: ler ─────────────────────────────────────────────────
let scanStream = null, scanLoop = null, scanContext = null;
function stopScan() {
  cancelAnimationFrame(scanLoop); scanLoop = null;
  if (scanStream) scanStream.getTracks().forEach(t => t.stop());
  scanStream = null;
}
$('#scan-dialog').addEventListener('close', stopScan);

// expected: { type, id } quando o app sabe o que vai ser lido (permite digitar só os 6 dígitos)
async function openScanner({ title, copy, expected = null }) {
  scanContext = expected;
  $('#scan-title').textContent = title; $('#scan-copy').textContent = copy;
  $('#scan-manual').value = ''; $('#scan-manual').placeholder = expected ? '000000' : 'Código MUTUM-XXXXXX';
  $('#scan-manual').inputMode = expected ? 'numeric' : 'text';
  $('#scan-status').textContent = 'Abrindo câmera…';
  $('#scan-dialog').showModal();
  const video = $('#scan-video');
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    video.srcObject = scanStream; await video.play();
    $('#scan-status').textContent = 'Aponte para o QR';
  } catch {
    $('#scan-status').textContent = 'Sem acesso à câmera. Digite o código abaixo.';
    return;
  }
  const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const tick = () => {
    if (!scanStream) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      const w = 480, h = Math.round(480 * video.videoHeight / video.videoWidth) || 480;
      canvas.width = w; canvas.height = h; ctx.drawImage(video, 0, 0, w, h);
      const found = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
      if (found && found.data.startsWith('mutum:')) { $('#scan-dialog').close(); handlePayload(found.data); return; }
    }
    scanLoop = requestAnimationFrame(tick);
  };
  scanLoop = requestAnimationFrame(tick);
}

$('#scan-form').addEventListener('submit', e => {
  e.preventDefault();
  const typed = $('#scan-manual').value.trim();
  if (!typed) { toast('Digite o código'); return; }
  $('#scan-dialog').close();
  if (scanContext) handlePayload(`mutum:${scanContext.type}:${scanContext.id}:${typed.replace(/\D/g, '')}`);
  else handlePayload(`mutum:pay:${typed.toUpperCase()}`);
});

async function handlePayload(text) {
  const [, type, id, code] = text.split(':');
  if (type === 'pay') { openPay(id); return; }
  if (scanContext && (scanContext.type !== type || String(scanContext.id) !== id)) { toast('Esse QR é de outra coisa.'); return; }
  const calls = {
    event: () => db.rpc('checkin_event', { p_event_id: Number(id), p_code: code }),
    urgency: () => db.rpc('complete_urgency', { p_id: Number(id), p_code: code }),
    order: () => db.rpc('complete_order', { p_order_id: Number(id), p_code: code })
  };
  if (!calls[type]) { toast('QR não reconhecido.'); return; }
  const { data, error } = await calls[type]();
  if (error) { toast(friendlyError(error)); return; }
  if (!data.ok) { toast(friendlyError({ message: data.error })); return; }
  await loadAll();
  if (type === 'event') modal('Presença confirmada!', `Você está no mutirão “${data.title}”. Se ele paga MTR, sua parte entra quando o organizador encerrar (ou sozinha, ${rule('auto_close_hours')} h depois do início).`, '♧');
  else modal('Pagamento recebido!', `+${data.amount} MTR por “${data.title}”.`, '✓');
}

// ─── Mutirão: presença ───────────────────────────────────────
function showEventQr(id) {
  const e = state.events.find(x => x.id === id); if (!e) return;
  const before = e.checkins;
  showRotatingQr({
    title: 'QR de presença', copy: `Quem está no mutirão “${e.title}” escaneia este QR em Mutirões → Estou aqui.`,
    type: 'event', id,
    fetchCode: () => db.rpc('get_event_code', { p_event_id: id }),
    isDone: async () => { await loadEvents(); const now = state.events.find(x => x.id === id); if (now && now.checkins !== before) { $('#qr-foot').textContent = `${now.checkins} ${now.checkins === 1 ? 'presença confirmada' : 'presenças confirmadas'}. O QR muda a cada 30 s.`; render(); } return false; }
  });
}

function closeEvent(id) {
  const e = state.events.find(x => x.id === id); if (!e) return;
  const min = rule('mutirao_min_people');
  const copy = !e.reward_total
    ? `Mutirão voluntário com ${e.checkins} ${e.checkins === 1 ? 'presença' : 'presenças'}. Depois de encerrar, ninguém mais confirma presença.`
    : e.checkins >= min
      ? `${e.checkins} presenças confirmadas. Os ${e.reward_total} MTR que você reservou são divididos: ${Math.floor(e.reward_total / e.checkins)} MTR para cada. A sobra volta para você.`
      : `Só ${e.checkins} ${e.checkins === 1 ? 'presença confirmada' : 'presenças confirmadas'}. É preciso pelo menos ${min} para pagar. Se encerrar agora, os ${e.reward_total} MTR voltam para você.`;
  modal('Encerrar mutirão?', copy, '♧', 'Encerrar', async () => {
    const { data, error } = await db.rpc('close_event', { p_event_id: id });
    if (error) { toast(friendlyError(error)); return; }
    await loadAll();
    modal('Mutirão encerrado', data > 0 ? `Você pagou ${data} MTR para quem participou. Obrigado!` : e.reward_total ? 'Ninguém foi pago e o valor voltou para você.' : 'Mutirão voluntário encerrado. Obrigado!', '♧');
  });
}

// ─── Urgência ────────────────────────────────────────────────
async function refreshUrgencies() { try { await loadUrgencies(); await loadProfile(); render(); } catch { /* sem rede: tenta depois */ } }

function showUrgencyQr(id) {
  const u = state.urgencies.find(x => x.id === id); if (!u) return;
  showRotatingQr({
    title: 'QR para pagar', copy: `${u.helper_name} escaneia este QR para receber ${u.reward} MTR. Só mostre quando estiver resolvido.`,
    type: 'urgency', id,
    fetchCode: () => db.rpc('get_urgency_code', { p_id: id }),
    isDone: async () => { await loadUrgencies(); const now = state.urgencies.find(x => x.id === id); return !now || now.status === 'done'; },
    onDone: async () => { await loadAll(); modal('Pago!', `${u.helper_name} recebeu ${u.reward} MTR. Obrigado por usar o Mutum.`, '✓'); }
  });
}

async function urgencyRpc(fn, id, okMsg) {
  const { error } = await db.rpc(fn, { p_id: id });
  if (error) { toast(friendlyError(error)); await refreshUrgencies(); return; }
  await loadAll(); if (okMsg) toast(okMsg);
}

function acceptUrgency(id) {
  const u = state.urgencies.find(x => x.id === id); if (!u) return;
  modal('Ajudar nesta urgência?', `“${u.title}” por ${u.reward} MTR. Ao aceitar, você vê o endereço e ${u.requester_name} passa a esperar por você. Quando resolver, escaneie o QR de ${u.requester_name} para receber.`, '!', 'Aceitar e ver endereço', () => urgencyRpc('accept_urgency', id, 'Você aceitou. O endereço está no cartão.'));
}

// ─── Pedidos de troca ────────────────────────────────────────
function showOrderQr(id) {
  const o = state.orders.find(x => x.id === id); if (!o) return;
  showRotatingQr({
    title: 'QR para pagar', copy: `${o.seller_name} escaneia este QR para receber ${o.price} MTR por “${o.title}”. Só mostre depois de receber.`,
    type: 'order', id,
    fetchCode: () => db.rpc('get_order_code', { p_order_id: id }),
    isDone: async () => { await loadOrders(); const now = state.orders.find(x => x.id === id); return !now || now.status === 'released'; },
    onDone: async () => { await loadAll(); modal('Pago!', `${o.seller_name} recebeu ${o.price} MTR.`, '✓'); }
  });
}

async function orderRpc(fn, id, okMsg) {
  const { error } = await db.rpc(fn, { p_order_id: id });
  if (error) { toast(friendlyError(error)); return; }
  await loadAll(); toast(okMsg);
}

// ─── Denúncia ────────────────────────────────────────────────
let reportTarget = null;
function openReport(target) {
  const [type, id] = target.split(':'); reportTarget = { type, id };
  $('#report-form').reset(); $('#report-dialog').showModal();
}
$('#report-form').addEventListener('submit', e => { e.preventDefault(); withSubmit(e.target, async () => {
  const { error } = await db.from('reports').insert({ target_type: reportTarget.type, target_id: reportTarget.id, reason: $('#report-reason').value.trim() });
  if (error) { toast(friendlyError(error)); return; }
  $('#report-dialog').close(); toast('Denúncia enviada. Obrigado.');
}); });

// ─── Pagar (transferência por QR) ────────────────────────────
function openPay(receiveCode) {
  if (state.profile && receiveCode === state.profile.receive_code) { toast('Esse QR é o seu.'); return; }
  $('#transfer-form').reset(); $('#transfer-to').value = receiveCode;
  $('#transfer-dialog').showModal(); $('#transfer-amount').focus();
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
    const { error } = await db.rpc('delete_event', { p_event_id: id });
    if (error) { toast(friendlyError(error)); return; }
    await loadAll(); toast(event.reward_total ? 'Mutirão excluído e valor devolvido' : 'Mutirão excluído');
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
$('#google-button').addEventListener('click', signInWithGoogle);

document.addEventListener('click', e => {
  const go = e.target.closest('[data-go]'); if (go) navigate(go.dataset.go);
  const join = e.target.closest('[data-join]'); if (join) toggleEvent(Number(join.dataset.join));
  const trade = e.target.closest('[data-trade]'); if (trade) openTrade(Number(trade.dataset.trade));
  const del = e.target.closest('[data-delete-event]'); if (del) deleteEvent(Number(del.dataset.deleteEvent));
  const close = e.target.closest('[data-close]'); if (close) $(`#${close.dataset.close}`).close();
  const icon = e.target.closest('[data-icon]'); if (icon) { tradeIcon = icon.dataset.icon; renderIconPicker(); }
  const act = (attr, fn) => { const el = e.target.closest(`[data-${attr}]`); if (el) fn(el.dataset[attr.replace(/-(\w)/g, (_, c) => c.toUpperCase())]); };
  act('event-qr', id => showEventQr(Number(id)));
  act('event-scan', id => { const ev = state.events.find(x => x.id === Number(id)); openScanner({ title: 'Confirmar presença', copy: `Escaneie o QR na tela de ${ev ? ev.created_by_name : 'quem organiza'}.`, expected: { type: 'event', id: Number(id) } }); });
  act('close-event', id => closeEvent(Number(id)));
  act('urgency-accept', id => acceptUrgency(Number(id)));
  act('urgency-cancel', id => modal('Cancelar urgência?', 'O valor reservado volta para o seu saldo.', '!', 'Cancelar urgência', () => urgencyRpc('cancel_urgency', Number(id), 'Urgência cancelada e valor devolvido')));
  act('urgency-release', id => urgencyRpc('release_helper', Number(id), 'A urgência voltou para a fila'));
  act('urgency-qr', id => showUrgencyQr(Number(id)));
  act('urgency-scan', id => { const u = state.urgencies.find(x => x.id === Number(id)); openScanner({ title: 'Receber pela ajuda', copy: `Escaneie o QR na tela de ${u ? u.requester_name : 'quem pediu'}.`, expected: { type: 'urgency', id: Number(id) } }); });
  act('order-qr', id => showOrderQr(Number(id)));
  act('order-scan', id => { const o = state.orders.find(x => x.id === Number(id)); openScanner({ title: 'Receber pela troca', copy: `Escaneie o QR na tela de ${o ? o.buyer_name : 'quem contratou'}.`, expected: { type: 'order', id: Number(id) } }); });
  act('order-dispute', id => modal('Reclamar deste pedido?', 'O valor continua reservado e não é liberado sozinho. Se o vendedor devolver, o valor volta para você.', '!', 'Reclamar', () => orderRpc('dispute_order', Number(id), 'Reclamação registrada')));
  act('order-refund', id => modal('Devolver o valor?', 'O valor reservado volta para quem contratou.', '↺', 'Devolver', () => orderRpc('refund_order', Number(id), 'Valor devolvido')));
  act('report', target => openReport(target));
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
$('#logout-button').addEventListener('click', async () => { $('#profile-dialog').close(); await db.auth.signOut(); });

$('#receive-button').addEventListener('click', () => {
  const code = state.profile ? state.profile.receive_code : '';
  $('#receive-code').textContent = code || '—';
  $('#receive-qr').innerHTML = code ? qrSvg(`mutum:pay:${code}`) : '';
  $('#receive-dialog').showModal();
});
$('#scan-button').addEventListener('click', () => openScanner({ title: 'Pagar ou receber', copy: 'Escaneie o QR de quem vai receber (Carteira → Receber). QRs de mutirão, urgência e pedido também funcionam aqui.' }));

$('#new-urgency-button').addEventListener('click', async () => {
  $('#urgency-form').reset();
  const { data: credit } = await db.rpc('my_credit');
  const fiado = credit ? ` Pode ficar até −${credit} MTR.` : ' Conta nova ainda não pode ficar negativa.';
  $('#urgency-hint').textContent = `Seu saldo: ${state.profile.balance} MTR.${fiado} O valor fica reservado agora e volta se você cancelar ou ninguém aceitar em ${rule('urgency_open_hours')} h.`;
  $('#urgency-dialog').showModal();
});
$('#urgency-form').addEventListener('submit', e => { e.preventDefault(); withSubmit(e.target, async () => {
  const reward = Math.floor(Number($('#urgency-reward').value));
  if (!Number.isFinite(reward) || reward < 1) { toast('Informe quanto você paga'); return; }
  const { error } = await db.rpc('create_urgency', { p_title: $('#urgency-title').value.trim(), p_description: $('#urgency-description').value.trim(), p_place: $('#urgency-place').value.trim(), p_reward: reward });
  if (error) { toast(friendlyError(error)); return; }
  $('#urgency-dialog').close(); await loadAll(); navigate('urgencia');
  toast('Pedido enviado para a vizinhança');
}); });

// urgência muda rápido: atualiza a cada 20 s enquanto o app está aberto
setInterval(() => { if (state.session && document.visibilityState === 'visible') refreshUrgencies(); }, 20000);
$('[data-close-receive]').addEventListener('click', () => $('#receive-dialog').close());
$('#copy-code-button').addEventListener('click', async () => { const code = $('#receive-code').textContent; try { await navigator.clipboard.writeText(code); toast('Código copiado'); } catch { toast(`Código: ${code}`); } });
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
  modal('Pagamento feito', `${amount} MTR enviados.`, '✓');
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
  $('#event-reward-hint').textContent = '';
  db.rpc('my_credit').then(({ data: credit }) => {
    $('#event-reward-hint').textContent = `Sai da sua carteira agora (saldo ${state.profile.balance} MTR${credit ? `, pode ficar até −${credit}` : '; conta nova ainda não fica negativa'}) e é dividido igualmente entre quem confirmar presença por QR. Com menos de ${rule('mutirao_min_people')} presenças, volta para você.`;
  });
  $('#event-dialog').showModal();
});
$('#event-form').addEventListener('submit', e => { e.preventDefault(); withSubmit(e.target, async () => {
  const startsAt = new Date($('#event-when').value);
  if (Number.isNaN(startsAt.getTime()) || startsAt < new Date(Date.now() - 3600000)) { toast('Escolha uma data futura'); return; }
  const reward = Math.max(0, Math.floor(Number($('#event-reward').value) || 0));
  const { error } = await db.rpc('create_event', {
    p_title: $('#event-title').value.trim(), p_place: $('#event-place').value.trim(),
    p_description: $('#event-description').value.trim(), p_starts_at: startsAt.toISOString(), p_reward_total: reward
  });
  if (error) { toast(friendlyError(error)); return; }
  $('#event-dialog').close(); await loadAll(); toast(reward ? `Mutirão publicado. ${reward} MTR reservados da sua carteira.` : 'Mutirão publicado');
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
