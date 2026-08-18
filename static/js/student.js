(function () {
  const videoEl = document.getElementById("videoEl");
  const canvas = document.getElementById("captureCanvas");
  const capturedImg = document.getElementById("capturedImg");
  const captureBtn = document.getElementById("captureBtn");
  const retakeBtn = document.getElementById("retakeBtn");
  const cameraControls = document.getElementById("cameraControls");
  const retakeControls = document.getElementById("retakeControls");
  const cameraHint = document.getElementById("cameraHint");
  const scanLine = document.getElementById("scanLine");
  const registerCard = document.getElementById("registerCard");
  const regName = document.getElementById("regName");
  const createAccountBtn = document.getElementById("createAccountBtn");
  const recordBtn = document.getElementById("recordBtn");
  const recordStatus = document.getElementById("recordStatus");
  const audioPreview = document.getElementById("audioPreview");

  let stream = null;
  let lastImageDataUrl = null;
  let audioDataUrl = null;
  let mediaRecorder = null;
  let audioChunks = [];
  const joinCode = new URLSearchParams(window.location.search).get("join-code");
  let pendingJoinSubject = null;

  async function loadJoinSubject() {
    if (!joinCode) return;
    const data = await apiCall(`/api/student/join-info?code=${encodeURIComponent(joinCode)}`);
    const joinSummary = document.getElementById("joinSubjectSummary");
    if (!joinSummary) return;

    if (!data.ok || !data.subject) {
      joinSummary.style.display = "block";
      joinSummary.textContent = data.error || "Invalid or expired join link";
      return;
    }
    pendingJoinSubject = data.subject;
    joinSummary.style.display = "block";
    joinSummary.innerHTML = `Joining: <strong>${data.subject.name}</strong> · ${data.subject.subject_code} · Section ${data.subject.section}`;
  }

  async function startCamera() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      videoEl.srcObject = stream;
      cameraHint.textContent = "Center your face in the frame, then capture.";
    } catch (err) {
      cameraHint.textContent = "Camera access denied. Please allow camera permissions and reload.";
      showToast("Could not access your camera", "error");
    }
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
  }

  function snapshot() {
    const w = videoEl.videoWidth || 480;
    const h = videoEl.videoHeight || 360;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(videoEl, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.9);
  }

  captureBtn.addEventListener("click", async () => {
    if (!stream) {
      await startCamera();
      return;
    }
    lastImageDataUrl = snapshot();
    capturedImg.src = lastImageDataUrl;

    videoEl.style.display = "none";
    capturedImg.style.display = "block";
    scanLine.style.display = "block";
    cameraControls.style.display = "none";
    retakeControls.style.display = "flex";
    cameraHint.textContent = "AI is scanning your face...";

    setButtonLoading(captureBtn, true);

    const data = await apiCall("/api/student/face-login", {
      method: "POST",
      body: { image: lastImageDataUrl },
    });

    scanLine.style.display = "none";
    setButtonLoading(captureBtn, false);

    if (!data.ok) {
      cameraHint.textContent = data.message || data.error || "Something went wrong.";
      showToast(data.message || data.error || "Scan failed", "warning");
      return;
    }

    if (data.recognized) {
      showToast(`Welcome back, ${data.student.name}!`, "success");
      cameraHint.textContent = "Recognized! Redirecting to your dashboard...";
      setTimeout(() => window.location.href = "/student", 900);
    } else {
      cameraHint.textContent = data.message || "Face not recognized — you might be new here!";
      registerCard.style.display = "block";
      registerCard.scrollIntoView({ behavior: "smooth", block: "start" });
      initFloatingLabels(registerCard);
    }
  });

  retakeBtn.addEventListener("click", () => {
    videoEl.style.display = "block";
    capturedImg.style.display = "none";
    cameraControls.style.display = "flex";
    retakeControls.style.display = "none";
    cameraHint.textContent = "Center your face in the frame, then capture.";
    registerCard.style.display = "none";
    lastImageDataUrl = null;
  });

  
  recordBtn.addEventListener("click", async () => {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
      return;
    }
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];
      mediaRecorder = new MediaRecorder(audioStream);
      mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunks, { type: "audio/webm" });
        const reader = new FileReader();
        reader.onloadend = () => {
          audioDataUrl = reader.result;
          audioPreview.src = audioDataUrl;
          audioPreview.style.display = "block";
        };
        reader.readAsDataURL(blob);
        audioStream.getTracks().forEach((t) => t.stop());
        recordBtn.textContent = "🎙️ Re-record voice sample";
        recordStatus.textContent = "Sample captured ✓";
      };
      mediaRecorder.start();
      recordBtn.textContent = "⏹ Stop recording";
      recordStatus.textContent = "Recording... speak now";
    } catch (err) {
      showToast("Microphone access denied", "error");
    }
  });

  
  createAccountBtn.addEventListener("click", async () => {
    const nameField = regName.closest(".field");
    const name = regName.value.trim();

    if (!name) {
      fieldError(nameField, "Please enter your name");
      showToast("Please enter your name", "warning");
      return;
    }
    if (!lastImageDataUrl) {
      showToast("Please capture your face photo first", "warning");
      return;
    }

    fieldSuccess(nameField);
    setButtonLoading(createAccountBtn, true);

    const data = await apiCall("/api/student/register", {
      method: "POST",
      body: {
        name,
        image: lastImageDataUrl,
        audio: audioDataUrl,
        join_code: joinCode,
        subject_id: pendingJoinSubject ? pendingJoinSubject.subject_id : null,
      },
    });

    setButtonLoading(createAccountBtn, false);

    if (!data.ok) {
      showToast(data.error || "Registration failed", "error");
      return;
    }

    showToast(`Profile created! Hi ${name}!`, "success");
    setTimeout(() => window.location.href = "/student", 900);
  });

  loadJoinSubject();
  startCamera();
  window.addEventListener("beforeunload", stopCamera);
})();
