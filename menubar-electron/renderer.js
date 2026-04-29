const form = document.getElementById('loginForm');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const loginBtn = document.getElementById('loginBtn');
const btnText = loginBtn.querySelector('.btn-text');
const spinner = loginBtn.querySelector('.spinner');
const errorEl = document.getElementById('error');

function setLoading(loading) {
  loginBtn.disabled = loading;
  emailInput.disabled = loading;
  passwordInput.disabled = loading;
  btnText.style.display = loading ? 'none' : 'inline';
  spinner.style.display = loading ? 'inline' : 'none';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  
  if (!email || !password) {
    errorEl.textContent = 'נא למלא את כל השדות';
    return;
  }
  
  setLoading(true);
  errorEl.textContent = '';
  
  try {
    const result = await window.api.login(email, password);
    
    if (result.success) {
      errorEl.classList.add('success');
      errorEl.textContent = '✓ התחברת בהצלחה!';
      // Window will be closed by main process
    } else {
      errorEl.textContent = result.error || 'שגיאה בהתחברות';
    }
  } catch (err) {
    errorEl.textContent = 'שגיאת תקשורת';
  }
  
  setLoading(false);
});

// Focus email on load
emailInput.focus();
