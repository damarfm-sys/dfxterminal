// ══════════════════════════════════════════════════════
// DFXAi AUTH — Supabase Authentication
// ══════════════════════════════════════════════════════
(function() {
  const SUPABASE_URL  = 'https://hkxgkvwyxgiygzmcwdsl.supabase.co';
  const SUPABASE_ANON = 'sb_publishable_6XiMHP0cdS4_NIRgDpYFwQ_7ADAZWv9';

  function getClient() {
    if (!window._sb) {
      window._sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
    }
    return window._sb;
  }

  // ── UI HELPERS ──
  function showMsg(id, type, msg) {
    var el = document.getElementById(id);
    if (!el) return;
    el.className = 'auth-msg ' + type + ' show';
    el.textContent = msg;
  }

  function clearMsgs() {
    ['loginMsg','registerMsg','resetMsg'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) { el.className = 'auth-msg'; el.textContent = ''; }
    });
  }

  function setBtn(id, disabled, text) {
    var b = document.getElementById(id);
    if (!b) return;
    b.disabled = disabled;
    b.textContent = text;
  }

  function revealTerminal(user) {
    var o = document.getElementById('authOverlay');
    if (o) {
      o.style.transition = 'opacity 0.5s';
      o.style.opacity = '0';
      setTimeout(function() { o.style.display = 'none'; }, 500);
    }
    var mb = document.getElementById('userMenuBtn');
    if (mb) mb.style.display = 'flex';
    var short = (user.email || '').split('@')[0].toUpperCase();
    var ed = document.getElementById('userEmailDisplay');
    var me = document.getElementById('userMenuEmail');
    if (ed) ed.textContent = '\u{1F464} ' + short;
    if (me) me.textContent = user.email || '';
  }

  // ── SWITCH TAB ──
  window.switchAuthTab = function(tab) {
    ['login','register','reset'].forEach(function(t) {
      var tid = 'tab'   + t.charAt(0).toUpperCase() + t.slice(1);
      var pid = 'panel' + t.charAt(0).toUpperCase() + t.slice(1);
      var te = document.getElementById(tid);
      var pe = document.getElementById(pid);
      if (te) te.classList.toggle('active', t === tab);
      if (pe) pe.classList.toggle('active', t === tab);
    });
    clearMsgs();
  };

  // ── LOGIN ──
  window.authLogin = async function() {
    var email = (document.getElementById('loginEmail')?.value || '').trim();
    var pass  =  document.getElementById('loginPassword')?.value || '';
    if (!email || !pass) { showMsg('loginMsg','error','⚠ Please enter email and password'); return; }
    setBtn('loginBtn', true, 'VERIFYING…');
    clearMsgs();
    try {
      var res = await getClient().auth.signInWithPassword({ email: email, password: pass });
      if (res.error) throw res.error;
      setBtn('loginBtn', true, '✓ ACCESS GRANTED');
      var lb = document.getElementById('loginBtn');
      if (lb) lb.style.background = 'var(--green)';
      setTimeout(function() { revealTerminal(res.data.user); }, 600);
    } catch(err) {
      showMsg('loginMsg','error','⚠ ' + (err.message || 'Login failed'));
      var aw = document.querySelector('.auth-wrap');
      if (aw) { aw.classList.add('shake'); setTimeout(function(){aw.classList.remove('shake');},400); }
      setBtn('loginBtn', false, 'ACCESS TERMINAL');
      var pp = document.getElementById('loginPassword');
      if (pp) pp.value = '';
    }
  };

  // ── REGISTER ──
  window.authRegister = async function() {
    var name    = (document.getElementById('regName')?.value     || '').trim();
    var email   = (document.getElementById('regEmail')?.value    || '').trim();
    var pass    =  document.getElementById('regPassword')?.value || '';
    var confirm =  document.getElementById('regConfirm')?.value  || '';
    if (!name||!email||!pass||!confirm) { showMsg('registerMsg','error','⚠ All fields required'); return; }
    if (pass.length < 8)  { showMsg('registerMsg','error','⚠ Password min 8 characters'); return; }
    if (pass !== confirm) { showMsg('registerMsg','error','⚠ Passwords do not match'); return; }
    setBtn('registerBtn', true, 'CREATING ACCOUNT…');
    clearMsgs();
    try {
      var res = await getClient().auth.signUp({
        email: email, password: pass,
        options: { data: { full_name: name }, emailRedirectTo: window.location.origin }
      });
      if (res.error) throw res.error;
      showMsg('registerMsg','success','✓ Check your email (' + email + ') to verify your account!');
      ['regName','regEmail','regPassword','regConfirm'].forEach(function(id) {
        var el = document.getElementById(id); if (el) el.value = '';
      });
    } catch(err) {
      showMsg('registerMsg','error','⚠ ' + (err.message || 'Registration failed'));
    }
    setBtn('registerBtn', false, 'CREATE ACCOUNT');
  };

  // ── RESET PASSWORD ──
  window.authReset = async function() {
    var email = (document.getElementById('resetEmail')?.value || '').trim();
    if (!email) { showMsg('resetMsg','error','⚠ Please enter your email'); return; }
    setBtn('resetBtn', true, 'SENDING…');
    clearMsgs();
    try {
      var res = await getClient().auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
      if (res.error) throw res.error;
      showMsg('resetMsg','success','✓ Reset link sent to ' + email + '!');
    } catch(err) {
      showMsg('resetMsg','error','⚠ ' + (err.message || 'Failed to send reset email'));
    }
    setBtn('resetBtn', false, 'SEND RESET LINK');
  };

  // ── LOGOUT ──
  window.authLogout = async function() {
    await getClient().auth.signOut();
    var mb = document.getElementById('userMenuBtn');
    if (mb) mb.style.display = 'none';
    if (window.toggleUserMenu) window.toggleUserMenu(false);
    var o = document.getElementById('authOverlay');
    if (o) { o.style.opacity = '1'; o.style.display = 'flex'; }
    window.switchAuthTab('login');
  };

  // ── USER MENU ──
  window.toggleUserMenu = function(force) {
    var dd = document.getElementById('userMenuDropdown');
    if (!dd) return;
    var show = (force !== undefined) ? force : !dd.classList.contains('show');
    dd.classList.toggle('show', show);
  };

  // ── INIT ──
  document.addEventListener('DOMContentLoaded', function() {
    // Enter key shortcuts
    var loginEmail = document.getElementById('loginEmail');
    var loginPass  = document.getElementById('loginPassword');
    var regConfirm = document.getElementById('regConfirm');
    var resetEmail = document.getElementById('resetEmail');
    if (loginEmail)  loginEmail.addEventListener('keydown',  function(e){ if(e.key==='Enter') window.authLogin(); });
    if (loginPass)   loginPass.addEventListener('keydown',   function(e){ if(e.key==='Enter') window.authLogin(); });
    if (regConfirm)  regConfirm.addEventListener('keydown',  function(e){ if(e.key==='Enter') window.authRegister(); });
    if (resetEmail)  resetEmail.addEventListener('keydown',  function(e){ if(e.key==='Enter') window.authReset(); });

    // Close dropdown on outside click
    document.addEventListener('click', function(e) {
      if (!e.target.closest('#userMenuBtn') && !e.target.closest('#userMenuDropdown')) {
        window.toggleUserMenu(false);
      }
    });

    // Check existing session
    getClient().auth.getSession().then(function(res) {
      if (res.data && res.data.session && res.data.session.user) {
        revealTerminal(res.data.session.user);
      }
    });

    // Auth state listener
    getClient().auth.onAuthStateChange(function(event, session) {
      if (event === 'SIGNED_IN' && session) {
        revealTerminal(session.user);
      } else if (event === 'SIGNED_OUT') {
        var o = document.getElementById('authOverlay');
        if (o) { o.style.opacity = '1'; o.style.display = 'flex'; }
      } else if (event === 'PASSWORD_RECOVERY') {
        window.switchAuthTab('reset');
        var o = document.getElementById('authOverlay');
        if (o) { o.style.opacity = '1'; o.style.display = 'flex'; }
      }
    });
  });

})();
