(function () {
  // ---------- State ----------
  let subjects = [];
  let attendancePhotos = []; // array of dataURLs
  let dialogStream = null;
  let voiceStream = null;
  let voiceRecorder = null;
  let voiceChunks = [];
  let voiceAudioDataUrl = null;
  let pendingLogs = null;

  // ---------- Tabs (top level) ----------
  const tabButtons = document.querySelectorAll(".tab-btn[data-tab]");
  function setActiveTab(tab) {
    tabButtons.forEach((b) => {
      const active = b.dataset.tab === tab;
      b.classList.toggle("btn-primary", active);
      b.classList.toggle("btn-tertiary", !active);
    });
    document.getElementById("panel-attendance").style.display = tab === "attendance" ? "block" : "none";
    document.getElementById("panel-subjects").style.display = tab === "subjects" ? "block" : "none";
    document.getElementById("panel-records").style.display = tab === "records" ? "block" : "none";

    if (tab === "subjects") loadSubjectsManage();
    if (tab === "records") loadRecords();
  }
  tabButtons.forEach((b) => b.addEventListener("click", () => setActiveTab(b.dataset.tab)));

  
  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await apiCall("/api/teacher/logout", { method: "POST" });
    window.location.href = "/teacher";
  });


  async function loadSubjectsForAttendance() {
    const data = await apiCall("/api/teacher/subjects");
    if (!data.ok) return;
    subjects = data.subjects;

    const warning = document.getElementById("noSubjectsWarning");
    const ui = document.getElementById("attendanceUI");
    if (!subjects.length) {
      warning.style.display = "block";
      ui.style.display = "none";
      return;
    }
    warning.style.display = "none";
    ui.style.display = "block";

    const select = document.getElementById("subjectSelect");
    select.innerHTML = subjects
      .map((s) => `<option value="${s.subject_id}">${s.name} - ${s.subject_code}</option>`)
      .join("");
  }

  function selectedSubjectId() {
    const select = document.getElementById("subjectSelect");
    return Number(select.value);
  }

  
  function renderGallery() {
    const wrap = document.getElementById("galleryWrap");
    const gallery = document.getElementById("photoGallery");
    const clearBtn = document.getElementById("clearPhotosBtn");
    const runBtn = document.getElementById("runAnalysisBtn");

    if (!attendancePhotos.length) {
      wrap.style.display = "none";
      clearBtn.disabled = true;
      runBtn.disabled = true;
      return;
    }
    wrap.style.display = "block";
    clearBtn.disabled = false;
    runBtn.disabled = false;
    gallery.innerHTML = attendancePhotos
      .map((src, i) => `<div class="photo-thumb"><img src="${src}" alt="Photo ${i + 1}"></div>`)
      .join("");
  }

  document.getElementById("clearPhotosBtn").addEventListener("click", () => {
    attendancePhotos = [];
    renderGallery();
  });

  document.getElementById("addPhotosBtn").addEventListener("click", () => {
    openModal("addPhotosModal");
    switchPhotoTab("camera");
  });


  function switchPhotoTab(which) {
    document.getElementById("photoTabCamera").classList.toggle("btn-primary", which === "camera");
    document.getElementById("photoTabCamera").classList.toggle("btn-tertiary", which !== "camera");
    document.getElementById("photoTabUpload").classList.toggle("btn-primary", which === "upload");
    document.getElementById("photoTabUpload").classList.toggle("btn-tertiary", which !== "upload");
    document.getElementById("photoCameraPanel").style.display = which === "camera" ? "block" : "none";
    document.getElementById("photoUploadPanel").style.display = which === "upload" ? "block" : "none";

    if (which === "camera") startDialogCamera();
    else stopDialogCamera();
  }
  document.getElementById("photoTabCamera").addEventListener("click", () => switchPhotoTab("camera"));
  document.getElementById("photoTabUpload").addEventListener("click", () => switchPhotoTab("upload"));

  async function startDialogCamera() {
    if (dialogStream) return;
    try {
      dialogStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      document.getElementById("dialogVideo").srcObject = dialogStream;
    } catch (e) {
      showToast("Could not access camera", "error");
    }
  }
  function stopDialogCamera() {
    if (dialogStream) {
      dialogStream.getTracks().forEach((t) => t.stop());
      dialogStream = null;
    }
  }

  document.getElementById("dialogSnapBtn").addEventListener("click", () => {
    const video = document.getElementById("dialogVideo");
    if (!video.videoWidth) {
      showToast("Camera not ready yet", "warning");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    attendancePhotos.push(canvas.toDataURL("image/jpeg", 0.9));
    renderGallery();
    showToast("Photo Captured", "success");
  });

  document.getElementById("fileUploadInput").addEventListener("change", (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    let remaining = files.length;
    files.forEach((f) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        attendancePhotos.push(reader.result);
        remaining -= 1;
        if (remaining === 0) {
          renderGallery();
          showToast("Photos uploaded successfully", "success");
        }
      };
      reader.readAsDataURL(f);
    });
    e.target.value = "";
  });

  document.getElementById("addPhotosModal").addEventListener("click", (e) => {
    if (e.target.id === "addPhotosModal" || e.target.closest("[data-close-modal]")) {
      stopDialogCamera();
    }
  });

  
  document.getElementById("runAnalysisBtn").addEventListener("click", async () => {
    const btn = document.getElementById("runAnalysisBtn");
    setButtonLoading(btn, true);

    const data = await apiCall("/api/teacher/attendance/photos/analyze", {
      method: "POST",
      body: { subject_id: selectedSubjectId(), images: attendancePhotos },
    });

    setButtonLoading(btn, false);

    if (!data.ok) {
      showToast(data.error || "Analysis failed", "error");
      return;
    }
    showResults(data.results, data.logs);
  });

  document.getElementById("voiceAttendanceBtn").addEventListener("click", () => {
    voiceAudioDataUrl = null;
    document.getElementById("voiceAudioPreview").style.display = "none";
    document.getElementById("voiceRecordStatus").textContent = "";
    document.getElementById("voiceRecordBtn").textContent = "🎙️ Record classroom audio";
    openModal("voiceModal");
  });

  document.getElementById("voiceRecordBtn").addEventListener("click", async () => {
    if (voiceRecorder && voiceRecorder.state === "recording") {
      voiceRecorder.stop();
      return;
    }
    try {
      voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceChunks = [];
      voiceRecorder = new MediaRecorder(voiceStream);
      voiceRecorder.ondataavailable = (e) => voiceChunks.push(e.data);
      voiceRecorder.onstop = () => {
        const blob = new Blob(voiceChunks, { type: "audio/webm" });
        const reader = new FileReader();
        reader.onloadend = () => {
          voiceAudioDataUrl = reader.result;
          const preview = document.getElementById("voiceAudioPreview");
          preview.src = voiceAudioDataUrl;
          preview.style.display = "block";
        };
        reader.readAsDataURL(blob);
        voiceStream.getTracks().forEach((t) => t.stop());
        document.getElementById("voiceRecordBtn").textContent = "🎙️ Re-record audio";
        document.getElementById("voiceRecordStatus").textContent = "Recording captured ✓";
      };
      voiceRecorder.start();
      document.getElementById("voiceRecordBtn").textContent = "⏹ Stop recording";
      document.getElementById("voiceRecordStatus").textContent = "Recording... let students speak";
    } catch (e) {
      showToast("Microphone access denied", "error");
    }
  });

  document.getElementById("analyzeVoiceBtn").addEventListener("click", async () => {
    if (!voiceAudioDataUrl) {
      showToast("Please record classroom audio first", "warning");
      return;
    }
    const btn = document.getElementById("analyzeVoiceBtn");
    setButtonLoading(btn, true);
    const data = await apiCall("/api/teacher/attendance/voice/analyze", {
      method: "POST",
      body: { subject_id: selectedSubjectId(), audio: voiceAudioDataUrl },
    });
    setButtonLoading(btn, false);

    if (!data.ok) {
      showToast(data.error || "Voice analysis failed", "error");
      return;
    }
    closeModal("voiceModal");
    showResults(data.results, data.logs);
  });


  function showResults(results, logs) {
    pendingLogs = logs;
    const tbody = document.getElementById("resultsTableBody");
    tbody.innerHTML = results
      .map(
        (r, i) => `
        <tr style="animation-delay:${i * 0.04}s;">
          <td>${r.name}</td>
          <td>${r.id}</td>
          <td>${r.source}</td>
          <td class="${r.present ? "status-present" : "status-absent"}">${r.present ? "✅ Present" : "❌ Absent"}</td>
        </tr>`
      )
      .join("");
    openModal("resultsModal");
  }

  document.getElementById("discardResultsBtn").addEventListener("click", () => {
    pendingLogs = null;
    attendancePhotos = [];
    renderGallery();
    closeModal("resultsModal");
  });

  document.getElementById("confirmResultsBtn").addEventListener("click", async () => {
    if (!pendingLogs) return;
    const btn = document.getElementById("confirmResultsBtn");
    setButtonLoading(btn, true);
    const data = await apiCall("/api/teacher/attendance/confirm", { method: "POST", body: { logs: pendingLogs } });
    setButtonLoading(btn, false);

    if (!data.ok) {
      showToast(data.error || "Sync failed!", "error");
      return;
    }
    showToast("Attendance taken", "success");
    pendingLogs = null;
    attendancePhotos = [];
    renderGallery();
    closeModal("resultsModal");
  });


  function subjectManageCardHTML(sub) {
    return `
      <div class="glass-card" data-reveal>
        <h3 style="font-size:1.25rem;">${sub.name}</h3>
        <p class="text-muted mt-1">
          Code: <span class="pill" style="margin:0 0.4rem;">${sub.subject_code}</span>
          Section: ${sub.section}
        </p>
        <div class="flex gap-sm mt-2" style="flex-wrap:wrap;">
          <span class="stat-chip">🫂 <b>${sub.total_students}</b> Students</span>
          <span class="stat-chip">🕰️ <b>${sub.total_classes}</b> Classes</span>
        </div>
        <button class="btn btn-tertiary btn-sm mt-2" data-share="${sub.subject_code}">
          🔗 Share Code: ${sub.name}
        </button>
      </div>
    `;
  }

  async function loadSubjectsManage() {
    const grid = document.getElementById("subjectsManageGrid");
    grid.innerHTML = `<div class="glass-card no-hover skeleton" style="height:160px;"></div>`;
    const data = await apiCall("/api/teacher/subjects");
    if (!data.ok) return;
    subjects = data.subjects;

    if (!subjects.length) {
      grid.innerHTML = `<div class="glass-card no-hover" style="grid-column:1/-1; text-align:center;">
        <p class="text-muted">No subjects found. Create one above!</p>
      </div>`;
      return;
    }
    grid.innerHTML = subjects.map(subjectManageCardHTML).join("");
    initReveal();
    document.querySelectorAll("[data-share]").forEach((btn) => {
      btn.addEventListener("click", () => openShareModal(btn.dataset.share));
    });
  }

  document.getElementById("createSubjectBtn").addEventListener("click", () => openModal("createSubjectModal"));

  document.getElementById("createSubjectConfirmBtn").addEventListener("click", async () => {
    const codeEl = document.getElementById("subCode");
    const nameEl = document.getElementById("subName");
    const sectionEl = document.getElementById("subSection");

    const subject_code = codeEl.value.trim();
    const name = nameEl.value.trim();
    const section = sectionEl.value.trim();

    if (!subject_code || !name || !section) {
      showToast("Please fill all the fields", "warning");
      return;
    }

    const btn = document.getElementById("createSubjectConfirmBtn");
    setButtonLoading(btn, true);
    const data = await apiCall("/api/teacher/subjects", { method: "POST", body: { subject_code, name, section } });
    setButtonLoading(btn, false);

    if (!data.ok) {
      showToast(data.error || "Could not create subject", "error");
      return;
    }
    showToast("Subject created successfully!", "success");
    codeEl.value = nameEl.value = sectionEl.value = "";
    closeModal("createSubjectModal");
    loadSubjectsManage();
    loadSubjectsForAttendance();
  });

  async function openShareModal(code) {
    const data = await apiCall(`/api/teacher/subjects/${encodeURIComponent(code)}/share`);
    if (!data.ok) {
      showToast(data.error || "Could not generate share link", "error");
      return;
    }
    document.getElementById("shareUrlText").textContent = data.url;
    document.getElementById("shareCodeText").textContent = data.code;
    document.getElementById("shareQrImg").src = `data:image/png;base64,${data.qr_base64}`;
    openModal("shareSubjectModal");
  }

  document.getElementById("copyLinkBtn").addEventListener("click", () => {
    const text = document.getElementById("shareUrlText").textContent;
    navigator.clipboard.writeText(text).then(() => showToast("Link copied!", "success"));
  });

  // ---------- Attendance Records tab ----------
  async function loadRecords() {
    const tbody = document.getElementById("recordsTableBody");
    const noMsg = document.getElementById("noRecordsMsg");
    tbody.innerHTML = "";
    const data = await apiCall("/api/teacher/attendance/records");
    if (!data.ok || !data.records.length) {
      noMsg.style.display = "block";
      return;
    }
    noMsg.style.display = "none";
    tbody.innerHTML = data.records
      .map(
        (r, i) => `
        <tr style="animation-delay:${i * 0.03}s;">
          <td>${r.time}</td>
          <td>${r.subject}</td>
          <td>${r.subject_code}</td>
          <td>✅ ${r.present} / ${r.total} Students</td>
        </tr>`
      )
      .join("");
  }


  loadSubjectsForAttendance();
})();
