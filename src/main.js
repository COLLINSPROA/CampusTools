import './style.css';
import { supabase, isSupabaseConfigured } from './lib/supabase.js';
import { getProfile, listVerifiedTotpFactors, requireAAL2, signOut } from './lib/auth.js';
import { convertOrResizeImage, removeImageBackground } from './tools/image-tools.js';
import { imagesToPdf, mergePdfs, splitPdf, textToPdf, pdfToImages } from './tools/pdf-tools.js';
import { docxToText, docxToPdfTextOnly, spreadsheetToCsv } from './tools/document-tools.js';

const app = document.querySelector('#app');
let activeUser = null;
let activeProfile = null;
let currentFactorId = null;
let currentChallengeId = null;
let isPasswordRecovery = false;

const icon = (name) => ({
  image:'▧', file:'▤', pdf:'PDF', word:'W', sheet:'X', shield:'◆',
  user:'●', lock:'▣', arrow:'→', spark:'✦'
}[name] || '•');

function shell(content) {
  app.innerHTML = `
    <a class="skip-link" href="#main-content">Skip to content</a>
    <header class="topbar">
      <a class="brand" href="#"><span class="brand-icon">C</span><span>Campus<span>Tools</span></span></a>
      <nav aria-label="Main navigation"><a href="#tools">Tools</a><a href="#how">How it works</a><a href="#security">Security</a></nav>
      <div id="top-actions"><a class="btn primary small" href="#account">Get started <span aria-hidden="true">→</span></a></div>
    </header>
    <main id="main-content">${content}</main>
    <footer><div class="brand"><span class="brand-icon">C</span><span>Campus<span>Tools</span></span></div><p>Useful tools for learning, creating and getting work done.</p><small>Process files responsibly. Keep a backup of important documents.</small></footer>`;
}

function notify(message, type = 'info') {
  const el = document.querySelector('#notice');
  if (!el) { alert(message); return; }
  el.className = `notice ${type}`;
  el.textContent = message;
  el.hidden = false;
}

function landing() {
  shell(`
    <section class="hero">
      <div class="hero-copy">
        <span class="eyebrow"><span class="pulse"></span> ONE SIMPLE WORKSPACE FOR EVERYDAY TASKS</span>
        <h1>Make busywork<br><em>feel lighter.</em></h1>
        <p>Convert files, prepare documents and get small tasks done without adding another app to your day.</p>
        <div class="hero-actions"><a class="btn primary" href="#tools">Explore the tools <span>→</span></a><a class="btn quiet" href="#account">Create your account</a></div>
        <div class="hero-meta"><span>✓ Works in your browser</span><span>✓ No installation needed</span><span>✓ Useful free tools</span></div>
      </div>
      <div class="hero-art"><div class="art-orbit orbit-one"></div><div class="art-orbit orbit-two"></div>
        <div class="art-card art-main"><div class="art-file">PDF</div><div><b>Document ready</b><small>Converted successfully</small></div><span class="check">✓</span></div>
        <div class="art-card art-small"><div class="art-photo">✦</div><div><b>Background removed</b><small>PNG · Transparent</small></div></div>
        <div class="art-sticker">✧</div>
      </div>
    </section>
    <section class="trust-strip" aria-label="CampusTools benefits"><span>FOR STUDY & EVERYDAY WORK</span><span>TOOLS IN ONE PLACE</span><span>NO INSTALLATION REQUIRED</span></section>
    <section id="tools" class="section">
      <div class="section-heading"><div><span class="eyebrow">PRACTICAL TOOLS, EASY TO FIND</span><h2>What would you like<br><em>to get done?</em></h2></div><p>Find a tool, sign in, and follow the steps. Most file processing happens in your browser.</p></div>
      <div class="tool-discovery">
        <label class="tool-search-label" for="tool-search">Search tools</label>
        <div class="tool-discovery-row">
          <input id="tool-search" class="tool-search" type="search" placeholder="Try “PDF”, “image” or “Excel”" autocomplete="off">
          <div class="tool-filters" role="group" aria-label="Filter tools by type">
            <button type="button" class="filter-chip active" data-tool-filter="all" aria-pressed="true">All tools</button>
            <button type="button" class="filter-chip" data-tool-filter="image" aria-pressed="false">Images</button>
            <button type="button" class="filter-chip" data-tool-filter="document" aria-pressed="false">Documents</button>
          </div>
        </div>
        <p id="tool-results" class="tool-results" aria-live="polite"></p>
      </div>
      <div class="tool-grid">
        <article class="tool-card featured" data-tool-card data-category="image"><div class="tool-icon purple" aria-hidden="true">▧</div><span class="tag">IMAGE TOOL</span><h3>Remove image background</h3><p>Make product photos, profile pictures and project images transparent.</p><a href="#account" class="tool-link">Sign in to use <b aria-hidden="true">→</b></a></article>
        <article class="tool-card" data-tool-card data-category="image"><div class="tool-icon blue" aria-hidden="true">⇄</div><span class="tag">IMAGE TOOL</span><h3>Convert & resize images</h3><p>Convert PNG, JPG and WebP, resize and compress images.</p><a href="#account" class="tool-link">Sign in to use <b aria-hidden="true">→</b></a></article>
        <article class="tool-card" data-tool-card data-category="document"><div class="tool-icon red" aria-hidden="true">PDF</div><span class="tag">DOCUMENT TOOL</span><h3>PDF tools</h3><p>Merge PDFs, extract pages, turn PDFs into images and create PDFs.</p><a href="#account" class="tool-link">Sign in to use <b aria-hidden="true">→</b></a></article>
        <article class="tool-card" data-tool-card data-category="document"><div class="tool-icon green" aria-hidden="true">W</div><span class="tag">DOCUMENT TOOL</span><h3>Word tools</h3><p>Extract DOCX text or create a text-based PDF from a Word file.</p><a href="#account" class="tool-link">Sign in to use <b aria-hidden="true">→</b></a></article>
        <article class="tool-card" data-tool-card data-category="document"><div class="tool-icon yellow" aria-hidden="true">X</div><span class="tag">DOCUMENT TOOL</span><h3>Excel to CSV</h3><p>Export the first worksheet of an Excel workbook to CSV.</p><a href="#account" class="tool-link">Sign in to use <b aria-hidden="true">→</b></a></article>
        <article class="tool-card" data-tool-card data-category="document"><div class="tool-icon dark" aria-hidden="true">T</div><span class="tag">DOCUMENT TOOL</span><h3>Text to PDF</h3><p>Turn notes and plain text into a downloadable PDF document.</p><a href="#account" class="tool-link">Sign in to use <b aria-hidden="true">→</b></a></article>
      </div>
      <p class="tool-empty" id="tool-empty" hidden>No tools match that search. Try another word or choose a different filter.</p>
    </section>
    <section id="how" class="steps-section"><span class="eyebrow">SIMPLE BY DESIGN</span><h2>Three steps. Less hassle.</h2><div class="steps"><div><b>01</b><h3>Choose a tool</h3><p>Pick the image or document task you need.</p></div><div><b>02</b><h3>Add your file</h3><p>Select a supported file from your device.</p></div><div><b>03</b><h3>Download</h3><p>Save the processed result back to your device.</p></div></div></section>
    <section id="security" class="security-band"><div class="security-symbol">◇</div><div><span class="eyebrow">SECURITY BUILT IN</span><h2>Your account deserves<br>an extra layer of protection.</h2><p>CampusTools uses secure sign-in and authenticator-based multi-factor authentication.</p></div><a class="btn light" href="#account">Create an account →</a></section>
    <section id="account" class="auth-section"><div class="auth-intro"><span class="eyebrow">YOUR WORKSPACE</span><h2>Get started with<br><em>CampusTools.</em></h2><p>Create an account to access the tools. Authenticator MFA is required for every account.</p><div class="mini-security">◇ &nbsp; Password + authenticator code</div></div><div id="auth-card" class="auth-card"></div></section>
    <div id="notice" class="notice" hidden></div>
  `);
  renderAuthCard();
  bindToolDiscovery();
}

function bindToolDiscovery() {
  const search = document.querySelector('#tool-search');
  const cards = [...document.querySelectorAll('[data-tool-card]')];
  const resultCount = document.querySelector('#tool-results');
  const emptyState = document.querySelector('#tool-empty');
  let activeFilter = 'all';

  function updateTools() {
    const query = search.value.trim().toLocaleLowerCase();
    let visibleCount = 0;

    cards.forEach(card => {
      const matchesQuery = card.textContent.toLocaleLowerCase().includes(query);
      const matchesFilter = activeFilter === 'all' || card.dataset.category === activeFilter;
      const isVisible = matchesQuery && matchesFilter;
      card.hidden = !isVisible;
      if (isVisible) visibleCount += 1;
    });

    resultCount.textContent = `${visibleCount} ${visibleCount === 1 ? 'tool' : 'tools'} available`;
    emptyState.hidden = visibleCount > 0;
  }

  search.addEventListener('input', updateTools);
  document.querySelectorAll('[data-tool-filter]').forEach(button => {
    button.addEventListener('click', () => {
      activeFilter = button.dataset.toolFilter;
      document.querySelectorAll('[data-tool-filter]').forEach(filterButton => {
        const isActive = filterButton === button;
        filterButton.classList.toggle('active', isActive);
        filterButton.setAttribute('aria-pressed', String(isActive));
      });
      updateTools();
    });
  });

  updateTools();
}

function renderAuthCard(mode = 'login') {
  const card = document.querySelector('#auth-card');
  if (!card) return;
  if (mode === 'forgot') {
    card.innerHTML = `
      <div class="mfa-panel">
        <span class="eyebrow">ACCOUNT RECOVERY</span>
        <h2>Forgot your password?</h2>
        <p>Enter the email address for your account and we'll send you a password reset link.</p>
        <form id="forgot-password-form" class="form-stack">
          <label>Email address<input name="email" type="email" required autocomplete="email" placeholder="you@example.com"></label>
          <button class="btn primary full" type="submit">Send recovery email <span>→</span></button>
        </form>
        <button id="back-to-login" class="text-button" type="button">Back to sign in</button>
      </div>`;
    card.querySelector('#forgot-password-form').addEventListener('submit', async event => {
      event.preventDefault();
      const email = new FormData(event.currentTarget).get('email').trim();
      try {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + window.location.pathname
        });
        if (error) throw error;
        notify('If an account exists for that email, a password recovery link will be sent.', 'success');
      } catch (error) { notify(error.message, 'error'); }
    });
    card.querySelector('#back-to-login').addEventListener('click', () => renderAuthCard('login'));
    return;
  }
  if (mode === 'recovery') {
    card.innerHTML = `
      <div class="mfa-panel">
        <span class="eyebrow">ACCOUNT RECOVERY</span>
        <h2>Choose a new password</h2>
        <p>Use at least eight characters for your new password.</p>
        <form id="recovery-password-form" class="form-stack">
          <label>New password<input name="password" type="password" required minlength="8" autocomplete="new-password" placeholder="At least 8 characters"></label>
          <label>Confirm new password<input name="confirm-password" type="password" required minlength="8" autocomplete="new-password" placeholder="Enter your new password again"></label>
          <button class="btn primary full" type="submit">Update password <span>→</span></button>
        </form>
      </div>`;
    card.querySelector('#recovery-password-form').addEventListener('submit', async event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const password = form.get('password');
      if (password !== form.get('confirm-password')) {
        notify('The passwords do not match.', 'error');
        return;
      }
      try {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        await signOut();
        isPasswordRecovery = false;
        const recoveryUrl = new URL(window.location.href);
        recoveryUrl.hash = '';
        recoveryUrl.searchParams.delete('type');
        window.history.replaceState(null, '', recoveryUrl.pathname + recoveryUrl.search);
        renderAuthCard('login');
        notify('Your password has been updated. Sign in with your new password.', 'success');
      } catch (error) { notify(error.message, 'error'); }
    });
    return;
  }
  card.innerHTML = `
    <div class="auth-tabs" role="group" aria-label="Choose an account action"><button type="button" class="${mode==='login'?'active':''}" data-mode="login" aria-pressed="${mode === 'login'}">Sign in</button><button type="button" class="${mode==='register'?'active':''}" data-mode="register" aria-pressed="${mode === 'register'}">Create account</button></div>
    <form id="auth-form" class="form-stack">
      ${mode==='register'?'<label>Full name<input name="name" required autocomplete="name" placeholder="Your name"></label>':''}
      <label>Email address<input name="email" type="email" required autocomplete="email" placeholder="you@example.com"></label>
      <label>Password<input name="password" type="password" required minlength="8" autocomplete="${mode==='login'?'current-password':'new-password'}" placeholder="At least 8 characters"></label>
      ${mode === 'login' ? '<button id="forgot-password" class="text-button" type="button">Forgot password?</button>' : ''}
      <button class="btn primary full" type="submit">${mode==='login'?'Sign in securely':'Create free account'} <span>→</span></button>
      <p class="form-note">By continuing, you agree to use CampusTools responsibly.</p>
    </form>`;
  card.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => renderAuthCard(button.dataset.mode)));
  card.querySelector('#forgot-password')?.addEventListener('click', () => renderAuthCard('forgot'));
  card.querySelector('#auth-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = form.get('email').trim();
    const password = form.get('password');
    try {
      if (mode === 'register') {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { data: { display_name: form.get('name').trim() },
            emailRedirectTo: window.location.origin + window.location.pathname }
        });
        if (error) throw error;
        notify('Account created. Check your email to confirm your address, then sign in.', 'success');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await continueToMfa();
      }
    } catch (error) { notify(error.message, 'error'); }
  });
}

async function continueToMfa() {
  const factors = await listVerifiedTotpFactors();
  if (!factors.length) return beginEnrollment();
  const factor = factors[0];
  currentFactorId = factor.id;
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw error;
  if (data.currentLevel === 'aal2') return enterWorkspace();
  const challenge = await supabase.auth.mfa.challenge({ factorId: currentFactorId });
  if (challenge.error) throw challenge.error;
  currentChallengeId = challenge.data.id;
  renderMfaChallenge();
}

async function beginEnrollment() {
  const { data: factorData, error: factorError } = await supabase.auth.mfa.listFactors();
  if (factorError) throw factorError;

  const staleFactors = (factorData.totp || []).filter(factor =>
    factor.status === 'unverified' &&
    factor.friendly_name === 'CampusTools authenticator'
  );
  for (const factor of staleFactors) {
    const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
    if (error) throw error;
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp', friendlyName: 'CampusTools authenticator'
  });
  if (error) throw error;
  currentFactorId = data.id;
  renderMfaEnrollment(data.totp.qr_code, data.totp.secret);
}

function renderMfaEnrollment(qrCode, secret) {
  const card = document.querySelector('#auth-card');
  card.innerHTML = `<div class="mfa-panel"><div class="tool-icon purple">◇</div><span class="eyebrow">SECURITY SETUP · REQUIRED</span><h2>Set up your authenticator</h2><p>Scan this QR code using Aegis, Google Authenticator or another TOTP app.</p><div class="qr-frame"><img id="enrollment-qr" alt="Authenticator setup QR code"></div><details><summary>Can't scan the QR code?</summary><code class="secret">${escapeHtml(secret)}</code></details><form id="enroll-form" class="form-stack"><label>Six-digit verification code<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required placeholder="000000"></label><button class="btn primary full">Verify and secure account →</button></form><p class="form-note">Save your authenticator safely. If you lose access, contact the site administrator for account recovery.</p></div>`;
  card.querySelector('#enrollment-qr').src = qrCode;
  card.querySelector('#enroll-form').addEventListener('submit', async event => {
    event.preventDefault();
    const code = new FormData(event.currentTarget).get('code').trim();
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: currentFactorId, code });
      if (error) throw error;
      await enterWorkspace();
    } catch (error) { notify(error.message, 'error'); }
  });
}

function renderMfaChallenge() {
  const card = document.querySelector('#auth-card');
  card.innerHTML = `<div class="mfa-panel"><div class="tool-icon purple">◇</div><span class="eyebrow">TWO-FACTOR VERIFICATION</span><h2>Check it's really you.</h2><p>Open your authenticator app and enter the current six-digit CampusTools code.</p><form id="challenge-form" class="form-stack"><label>Authenticator code<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required placeholder="000000"></label><button class="btn primary full">Verify and continue →</button></form><button id="back-login" class="text-button">Back to sign in</button></div>`;
  card.querySelector('#challenge-form').addEventListener('submit', async event => {
    event.preventDefault();
    const code = new FormData(event.currentTarget).get('code').trim();
    try {
      const { error } = await supabase.auth.mfa.verify({ factorId: currentFactorId, challengeId: currentChallengeId, code });
      if (error) throw error;
      await enterWorkspace();
    } catch (error) { notify(error.message, 'error'); }
  });
  card.querySelector('#back-login').addEventListener('click', async () => { await signOut(); renderAuthCard(); });
}

async function enterWorkspace() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw error || new Error('Please sign in again.');
  const aal2 = await requireAAL2();
  if (!aal2) throw new Error('MFA verification is required before using CampusTools.');
  activeUser = user;
  activeProfile = await getProfile(user.id);
  renderWorkspace();
}

function renderWorkspace() {
  const role = activeProfile.role;
  const top = document.querySelector('#top-actions');
  if (top) top.innerHTML = `<span class="user-chip">${escapeHtml(activeProfile.display_name || activeUser.email)}</span><button id="logout" class="btn outline small">Sign out</button>`;
  const main = document.querySelector('main');
  main.innerHTML = `
    <section class="workspace-head"><div><span class="eyebrow">YOUR SECURE WORKSPACE</span><h1>Welcome${activeProfile.display_name ? ', '+escapeHtml(activeProfile.display_name.split(' ')[0]) : ''}.</h1><p>Choose a tool to get started. Your files are processed locally where possible.</p></div><span class="secure-pill">◇ MFA verified</span></section>
    <div id="notice" class="notice" hidden></div>
    <section class="workspace-grid">
      <div class="workspace-card"><div class="tool-icon purple">▧</div><span class="tag">IMAGE TOOLS</span><h3>Remove background</h3><p>Remove an image background and download a transparent PNG.</p><input id="bg-file" type="file" accept="image/*"><button id="bg-run" class="btn primary full">Remove background</button></div>
      <div class="workspace-card"><div class="tool-icon blue">⇄</div><span class="tag">IMAGE TOOLS</span><h3>Convert, resize & compress</h3><p>Convert images to PNG, JPG or WebP and optionally resize.</p><input id="image-file" type="file" accept="image/*"><div class="control-row"><select id="image-format"><option value="image/png">PNG</option><option value="image/jpeg">JPG</option><option value="image/webp">WebP</option></select><input id="image-width" type="number" min="0" placeholder="Max width (optional)"></div><button id="image-run" class="btn primary full">Convert image</button></div>
      <div class="workspace-card"><div class="tool-icon red">PDF</div><span class="tag">PDF TOOLS</span><h3>Merge PDF files</h3><p>Combine multiple PDF documents into one file.</p><input id="merge-files" type="file" accept="application/pdf,.pdf" multiple><button id="merge-run" class="btn primary full">Merge PDFs</button></div>
      <div class="workspace-card"><div class="tool-icon red">PDF</div><span class="tag">PDF TOOLS</span><h3>Extract PDF pages</h3><p>Save selected pages, e.g. 1-3,5, from a PDF.</p><input id="split-file" type="file" accept="application/pdf,.pdf"><input id="page-range" placeholder="Page range, e.g. 1-3,5"><button id="split-run" class="btn primary full">Extract pages</button></div>
      <div class="workspace-card"><div class="tool-icon blue">▧</div><span class="tag">PDF TOOLS</span><h3>Images to PDF</h3><p>Combine JPG or PNG images into a PDF.</p><input id="images-pdf-files" type="file" accept="image/png,image/jpeg" multiple><button id="images-pdf-run" class="btn primary full">Create PDF</button></div>
      <div class="workspace-card"><div class="tool-icon red">PDF</div><span class="tag">PDF TOOLS</span><h3>PDF to images</h3><p>Render each PDF page as a PNG image.</p><input id="pdf-images-file" type="file" accept="application/pdf,.pdf"><button id="pdf-images-run" class="btn primary full">Convert pages to PNG</button></div>
      <div class="workspace-card"><div class="tool-icon dark">T</div><span class="tag">DOCUMENT TOOLS</span><h3>Text to PDF</h3><p>Paste notes or an assignment and create a PDF.</p><textarea id="text-content" rows="4" placeholder="Paste or type your text here…"></textarea><button id="text-pdf-run" class="btn primary full">Download PDF</button></div>
      <div class="workspace-card"><div class="tool-icon green">W</div><span class="tag">DOCUMENT TOOLS</span><h3>Word (DOCX) to text</h3><p>Extract text from a DOCX file. Basic formatting is not retained.</p><input id="docx-file" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"><div class="button-pair"><button id="docx-text-run" class="btn primary">Download TXT</button><button id="docx-pdf-run" class="btn outline">Text PDF</button></div></div>
      <div class="workspace-card"><div class="tool-icon yellow">X</div><span class="tag">DOCUMENT TOOLS</span><h3>Excel to CSV</h3><p>Export the first worksheet of an Excel workbook to CSV.</p><input id="xlsx-file" type="file" accept=".xlsx,.xls,.xlsm"><button id="xlsx-run" class="btn primary full">Convert to CSV</button></div>
    </section>
    <section class="limitations"><b>About file privacy and compatibility</b><p>Most tools in this starter build run in your browser. Very large files may use substantial device memory. DOCX-to-PDF currently exports extracted text only; complex page layout is not preserved. Full PDF-to-Word and PowerPoint conversion require a separate conversion engine and are planned for a later phase.</p></section>
    ${role === 'admin' ? `<section class="admin-panel"><span class="eyebrow">ADMINISTRATION</span><h2>Administrator access</h2><p>You are signed in with the administrator role. Admin-only management features can be added here.</p><span class="secure-pill">Admin role · MFA verified</span></section>` : ''}
  `;
  document.querySelector('#logout')?.addEventListener('click', async () => { await signOut(); activeUser = null; activeProfile = null; location.reload(); });
  bindTool('bg-run', async () => removeImageBackground(requiredFile('bg-file')));
  bindTool('image-run', async () => convertOrResizeImage(requiredFile('image-file'), { format: value('image-format'), maxWidth: Number(value('image-width')) || 0 }));
  bindTool('merge-run', async () => mergePdfs([...document.querySelector('#merge-files').files]));
  bindTool('split-run', async () => splitPdf(requiredFile('split-file'), value('page-range')));
  bindTool('images-pdf-run', async () => imagesToPdf([...document.querySelector('#images-pdf-files').files]));
  bindTool('pdf-images-run', async () => pdfToImages(requiredFile('pdf-images-file')));
  bindTool('text-pdf-run', async () => textToPdf(value('text-content')));
  bindTool('docx-text-run', async () => docxToText(requiredFile('docx-file')));
  bindTool('docx-pdf-run', async () => docxToPdfTextOnly(requiredFile('docx-file')));
  bindTool('xlsx-run', async () => spreadsheetToCsv(requiredFile('xlsx-file')));
}

function requiredFile(id) {
  const file = document.getElementById(id).files[0];
  if (!file) throw new Error('Please choose a file first.');
  return file;
}
function value(id) { return document.getElementById(id).value; }
function bindTool(id, action) {
  document.getElementById(id)?.addEventListener('click', async () => {
    try { await action(); notify('Your file is ready to download.', 'success'); }
    catch (error) { notify(error.message || 'The operation failed.', 'error'); }
  });
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}

if (!isSupabaseConfigured) {
  landing();
  const card = document.querySelector('#auth-card');
  card.innerHTML = `<div class="setup-warning"><div class="tool-icon yellow">!</div><h3>Connect your Supabase project</h3><p>Copy <code>.env.example</code> to <code>.env</code>, then add your Supabase Project URL and publishable key. See README.md for setup instructions.</p></div>`;
} else {
  landing();
  const hashParams = new URLSearchParams(window.location.hash.slice(1));
  const searchParams = new URLSearchParams(window.location.search);
  if (hashParams.get('type') === 'recovery' || searchParams.get('type') === 'recovery') {
    isPasswordRecovery = true;
    renderAuthCard('recovery');
  }
  supabase.auth.onAuthStateChange(event => {
    if (event === 'PASSWORD_RECOVERY') {
      isPasswordRecovery = true;
      renderAuthCard('recovery');
    }
  });
  // Sign-in is handled explicitly by the login form. Avoid running the MFA
  // flow twice from both the form handler and SIGNED_IN auth event.
  supabase.auth.getSession().then(async ({ data, error }) => {
    if (error || !data.session || isPasswordRecovery) return;
    try {
      if (await requireAAL2()) await enterWorkspace();
      else await continueToMfa();
    } catch (error) { notify(error.message, 'error'); }
  });
}
