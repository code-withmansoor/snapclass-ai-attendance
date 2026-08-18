(function () {
  const subjectsGrid = document.getElementById("subjectsGrid");
  const logoutBtn = document.getElementById("logoutBtn");
  const enrollBtn = document.getElementById("enrollBtn");
  const enrollConfirmBtn = document.getElementById("enrollConfirmBtn");
  const joinCodeInput = document.getElementById("joinCodeInput");

  function subjectCardHTML(sub) {
    const pct = sub.total > 0 ? Math.round((sub.attended / sub.total) * 100) : 0;
    return `
      <div class="glass-card" data-reveal>
        <div class="flex-between">
          <h3 style="font-size:1.25rem;">${sub.name}</h3>
        </div>
        <p class="text-muted mt-1">
          Code: <span class="pill" style="margin:0 0.4rem;">${sub.subject_code}</span>
          Section: ${sub.section}
        </p>
        <div class="flex gap-sm mt-2" style="flex-wrap:wrap;">
          <span class="stat-chip">📅 <b>${sub.total}</b> Total</span>
          <span class="stat-chip">✅ <b>${sub.attended}</b> Attended</span>
        </div>
        <div class="progress-bar mt-2">
          <div class="progress-bar-fill" data-pct="${pct}"></div>
        </div>
        <button class="btn btn-tertiary btn-sm mt-2" data-unenroll="${sub.subject_id}" data-name="${sub.name}">
          🗑️ Unenroll from this course
        </button>
      </div>
    `;
  }

  async function loadSubjects() {
    const data = await apiCall("/api/student/subjects");
    if (!data.ok) {
      subjectsGrid.innerHTML = `<p class="text-muted">Could not load your subjects.</p>`;
      return;
    }
    if (!data.subjects.length) {
      subjectsGrid.innerHTML = `<div class="glass-card no-hover" style="grid-column:1/-1; text-align:center;">
        <p class="text-muted">You're not enrolled in any subjects yet. Click "Enroll in Subject" to join one!</p>
      </div>`;
      return;
    }
    subjectsGrid.innerHTML = data.subjects.map(subjectCardHTML).join("");
    initReveal();
    document.querySelectorAll(".progress-bar-fill").forEach((el) => {
      animateProgress(el, Number(el.dataset.pct));
    });
    document.querySelectorAll("[data-unenroll]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        setButtonLoading(btn, true);
        const res = await apiCall("/api/student/unenroll", {
          method: "POST",
          body: { subject_id: Number(btn.dataset.unenroll) },
        });
        setButtonLoading(btn, false);
        if (res.ok) {
          showToast(`Unenrolled from ${btn.dataset.name}`, "success");
          loadSubjects();
        } else {
          showToast(res.error || "Could not unenroll", "error");
        }
      });
    });
  }

  logoutBtn.addEventListener("click", async () => {
    setButtonLoading(logoutBtn, true);
    await apiCall("/api/student/logout", { method: "POST" });
    window.location.href = "/student";
  });

  enrollBtn.addEventListener("click", () => openModal("enrollModal"));

  enrollConfirmBtn.addEventListener("click", async () => {
    const field = joinCodeInput.closest(".field");
    const code = joinCodeInput.value.trim();
    if (!code) {
      fieldError(field, "Please enter a subject code");
      return;
    }
    setButtonLoading(enrollConfirmBtn, true);
    const data = await apiCall("/api/student/enroll", { method: "POST", body: { join_code: code } });
    setButtonLoading(enrollConfirmBtn, false);

    if (!data.ok) {
      fieldError(field, data.error);
      showToast(data.error || "Could not enroll", "error");
      return;
    }
    showToast(`Enrolled in ${data.subject.name}!`, "success");
    joinCodeInput.value = "";
    closeModal("enrollModal");
    loadSubjects();
  });

  
  async function handleJoinCode() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("join-code");
    if (!code) return;

    const data = await apiCall(`/api/student/join-info?code=${encodeURIComponent(code)}`);
    const textEl = document.getElementById("autoEnrollText");
    const actionsEl = document.getElementById("autoEnrollActions");

    if (!data.ok) {
      textEl.textContent = data.error || "Subject code not found.";
      actionsEl.innerHTML = `<button class="btn btn-tertiary btn-block" data-close-modal>Close</button>`;
      openModal("autoEnrollModal");
      return;
    }
    if (data.already_enrolled) {
      textEl.textContent = `You're already enrolled in ${data.subject.name}.`;
      actionsEl.innerHTML = `<button class="btn btn-tertiary btn-block" data-close-modal>Got it!</button>`;
      openModal("autoEnrollModal");
      return;
    }

    textEl.innerHTML = `Would you like to enroll in <b>${data.subject.name}</b>?`;
    actionsEl.innerHTML = `
      <button class="btn btn-tertiary" style="flex:1;" id="joinNoBtn">No thanks</button>
      <button class="btn btn-primary" style="flex:1;" id="joinYesBtn">Yes, enroll now!</button>
    `;
    openModal("autoEnrollModal");

    document.getElementById("joinNoBtn").addEventListener("click", () => {
      closeModal("autoEnrollModal");
      history.replaceState(null, "", "/student");
    });
    document.getElementById("joinYesBtn").addEventListener("click", async (e) => {
      setButtonLoading(e.target, true);
      const res = await apiCall("/api/student/enroll", { method: "POST", body: { join_code: code } });
      setButtonLoading(e.target, false);
      if (res.ok) {
        showToast(`Joined ${res.subject.name} successfully!`, "success");
        closeModal("autoEnrollModal");
        history.replaceState(null, "", "/student");
        loadSubjects();
      } else {
        showToast(res.error || "Could not enroll", "error");
      }
    });
  }

  loadSubjects();
  handleJoinCode();
})();
