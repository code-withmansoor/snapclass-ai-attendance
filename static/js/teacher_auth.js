(function () {
  const authTitle = document.getElementById("authTitle");
  const loginForm = document.getElementById("loginForm");
  const registerForm = document.getElementById("registerForm");

  document.getElementById("showRegisterBtn").addEventListener("click", () => {
    loginForm.style.display = "none";
    registerForm.style.display = "block";
    registerForm.classList.add("reveal");
    authTitle.innerHTML = `Register as a <span class="gradient-text">Teacher</span>`;
    initFloatingLabels(registerForm);
  });

  document.getElementById("showLoginBtn").addEventListener("click", () => {
    registerForm.style.display = "none";
    loginForm.style.display = "block";
    authTitle.innerHTML = `Login using <span class="gradient-text">Password</span>`;
  });

  document.getElementById("loginBtn").addEventListener("click", async () => {
    const userField = document.getElementById("loginUsername").closest(".field");
    const passField = document.getElementById("loginPassword").closest(".field");
    const username = document.getElementById("loginUsername").value.trim();
    const password = document.getElementById("loginPassword").value;

    if (!username || !password) {
      if (!username) fieldError(userField, "Required");
      if (!password) fieldError(passField, "Required");
      return;
    }

    const btn = document.getElementById("loginBtn");
    setButtonLoading(btn, true);
    const data = await apiCall("/api/teacher/login", { method: "POST", body: { username, password } });
    setButtonLoading(btn, false);

    if (!data.ok) {
      fieldError(passField, data.error);
      showToast(data.error || "Invalid username or password", "error");
      return;
    }
    showToast("Welcome back! 👋", "success");
    setTimeout(() => (window.location.href = "/teacher"), 700);
  });

  document.getElementById("registerBtn").addEventListener("click", async () => {
    const username = document.getElementById("regUsername").value.trim();
    const name = document.getElementById("regFullName").value.trim();
    const password = document.getElementById("regPassword").value;
    const confirm = document.getElementById("regConfirm").value;

    const btn = document.getElementById("registerBtn");
    setButtonLoading(btn, true);
    const data = await apiCall("/api/teacher/register", {
      method: "POST",
      body: { username, name, password, confirm },
    });
    setButtonLoading(btn, false);

    if (!data.ok) {
      showToast(data.error || "Registration failed", "error");
      return;
    }
    showToast(data.message || "Registered successfully!", "success");
    setTimeout(() => document.getElementById("showLoginBtn").click(), 800);
  });

  initFloatingLabels();
})();
