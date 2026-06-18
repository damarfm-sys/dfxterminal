// DFXAi Auth - Supabase
(function() {
  var SUPA_URL  = 'https://hkxgkvwyxgiygzmcwdsl.supabase.co';
  var SUPA_ANON = 'sb_publishable_6XiMHP0cdS4_NIRgDpYFwQ_7ADAZWv9';
  var _sb = null;

  function client() {
    if (!_sb) _sb = window.supabase.createClient(SUPA_URL, SUPA_ANON);
    return _sb;
  }

  function msg(id, type, text) {
    var el = document.getElementById(id);
    if (!el) return;
    el.className = 'auth-msg ' + type + ' show';
    el.textContent = text;
  }

  function clearMsgs() {
    ['loginMsg','registerMsg','resetMsg'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) { el.className = 'auth-msg'; el.textContent = ''; }
    });
  }

  function btn(id, dis, txt) {
    var b = document.getElementById(id);
    if (b) { b.disabled = dis; b.textContent = txt; }
  }

  function reveal(user) {
    var o = document.getElementById('authOverlay');
    if (o) { o.style.transition='opacity 0.5s'; o.style.opacity='0'; setTimeout(function(){o.style.display='none';},500); }
    var mb = document.getElementById('userMenuBtn');
    if (mb) mb.style.display = 'flex';
    var short = (user.email||'').split('@')[0].toUpperCase();
    var ed = document.getElementById('userEmailDisplay');
    var me = document.getElementById('userMenuEmail');
    if (ed) ed.textContent = String.fromCodePoint(0x1F464)+' '+short;
    if (me) me.textContent = user.email||'';
  }

  window.switchAuthTab = function(tab) {
    ['login','register','reset'].forEach(function(t) {
      var te = document.getElementById('tab'+t.charAt(0).toUpperCase()+t.slice(1));
      var pe = document.getElementById('panel'+t.charAt(0).toUpperCase()+t.slice(1));
      if (te) te.classList.toggle('active', t===tab);
      if (pe) pe.classList.toggle('active', t===tab);
    });
    clearMsgs();
  };

  window.authLogin = async function() {
    var email = (document.getElementById('loginEmail').value||'').trim();
    var pass  =  document.getElementById('loginPassword').value||'';
    if (!email||!pass) { msg('loginMsg','error','⚠ Enter email and password'); return; }
    btn('loginBtn', true, 'VERIFYING...');
    clearMsgs();
    var r = await client().auth.signInWithPassword({email:email, password:pass});
    if (r.error) {
      msg('loginMsg','error','⚠ '+(r.error.message||'Login failed'));
      var aw = document.querySelector('.auth-wrap');
      if (aw) { aw.classList.add('shake'); setTimeout(function(){aw.classList.remove('shake');},400); }
      btn('loginBtn', false, 'ACCESS TERMINAL');
      document.getElementById('loginPassword').value = '';
    } else {
      btn('loginBtn', true, '✓ ACCESS GRANTED');
      var lb = document.getElementById('loginBtn');
      if (lb) lb.style.background = 'var(--green)';
      setTimeout(function(){ reveal(r.data.user); }, 600);
    }
  };

  window.authRegister = async function() {
    var name  = (document.getElementById('regName').value||'').trim();
    var email = (document.getElementById('regEmail').value||'').trim();
    var pass  =  document.getElementById('regPassword').value||'';
    var conf  =  document.getElementById('regConfirm').value||'';
    if (!name||!email||!pass||!conf) { msg('registerMsg','error','⚠ All fields required'); return; }
    if (pass.length < 8) { msg('registerMsg','error','⚠ Password min 8 characters'); return; }
    if (pass !== conf)   { msg('registerMsg','error','⚠ Passwords do not match'); return; }
    btn('registerBtn', true, 'CREATING...');
    clearMsgs();
    var r = await client().auth.signUp({email:email, password:pass, options:{data:{full_name:name}, emailRedirectTo:location.origin}});
    if (r.error) { msg('registerMsg','error','⚠ '+(r.error.message||'Failed')); }
    else { msg('registerMsg','success','✓ Check your email ('+email+') to verify!'); ['regName','regEmail','regPassword','regConfirm'].forEach(function(id){var e=document.getElementById(id);if(e)e.value='';}); }
    btn('registerBtn', false, 'CREATE ACCOUNT');
  };

  window.authReset = async function() {
    var email = (document.getElementById('resetEmail').value||'').trim();
    if (!email) { msg('resetMsg','error','⚠ Enter your email'); return; }
    btn('resetBtn', true, 'SENDING...');
    clearMsgs();
    var r = await client().auth.resetPasswordForEmail(email, {redirectTo:location.origin});
    if (r.error) { msg('resetMsg','error','⚠ '+(r.error.message||'Failed')); }
    else { msg('resetMsg','success','✓ Reset link sent to '+email+'!'); }
    btn('resetBtn', false, 'SEND RESET LINK');
  };

  window.authLogout = async function() {
    await client().auth.signOut();
    var mb = document.getElementById('userMenuBtn');
    if (mb) mb.style.display = 'none';
    window.toggleUserMenu(false);
    var o = document.getElementById('authOverlay');
    if (o) { o.style.opacity='1'; o.style.display='flex'; }
    window.switchAuthTab('login');
  };

  window.toggleUserMenu = function(force) {
    var dd = document.getElementById('userMenuDropdown');
    if (!dd) return;
    var show = (force!==undefined) ? force : !dd.classList.contains('show');
    dd.classList.toggle('show', show);
  };

  document.addEventListener('DOMContentLoaded', function() {
    // Enter key
    ['loginEmail','loginPassword'].forEach(function(id){
      var el = document.getElementById(id);
      if (el) el.addEventListener('keydown', function(e){ if(e.key==='Enter') window.authLogin(); });
    });
    document.getElementById('regConfirm') && document.getElementById('regConfirm').addEventListener('keydown', function(e){ if(e.key==='Enter') window.authRegister(); });
    document.getElementById('resetEmail') && document.getElementById('resetEmail').addEventListener('keydown', function(e){ if(e.key==='Enter') window.authReset(); });

    // Close menu on outside click
    document.addEventListener('click', function(e) {
      if (!e.target.closest('#userMenuBtn') && !e.target.closest('#userMenuDropdown')) window.toggleUserMenu(false);
    });

    // Check session
    client().auth.getSession().then(function(r) {
      if (r.data && r.data.session) reveal(r.data.session.user);
    });

    client().auth.onAuthStateChange(function(event, session) {
      if (event==='SIGNED_IN' && session) reveal(session.user);
      else if (event==='SIGNED_OUT') {
        var o = document.getElementById('authOverlay');
        if (o) { o.style.opacity='1'; o.style.display='flex'; }
      }
    });
  });
})();
