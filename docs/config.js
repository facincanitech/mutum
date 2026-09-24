// Dados do projeto Supabase (botão "Connect" ou Project Settings → API Keys).
// A publishable key (sb_publishable_...) é pública por design: quem protege os dados são as regras de RLS em supabase/schema.sql.
// NUNCA coloque aqui a secret key (sb_secret_...) nem a service_role.
window.MUTUM_CONFIG = {
  supabaseUrl: 'https://kyrymthghohsyjlvwhca.supabase.co',
  supabaseAnonKey: 'sb_publishable_EnYVnNqcFda6cj81ytLVWg_yxqEYK1I',
  // Deep link de volta do login (Google e link do e-mail) no app Android (cadastre em Auth → URL Configuration → Redirect URLs)
  nativeRedirectUrl: 'br.com.mutum.app://login-callback'
};
