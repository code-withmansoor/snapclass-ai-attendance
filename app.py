import base64
import binascii
import csv
import io
import logging
import os
import time
from datetime import datetime

import numpy as np
import segno
from flask import Flask, render_template, request, jsonify, session, send_file
from PIL import Image, ImageOps, UnidentifiedImageError

from src.database.db import (
    check_teacher_exists,
    create_teacher,
    teacher_login,
    get_teacher_by_id,
    get_teacher_subjects,
    get_attendance_for_teacher,
    get_attendance_session_for_teacher,
    create_subject,
    get_subject_by_id,
    get_subject_by_code,
    get_subject_enrolled_students,
    enroll_student_to_subject,
    is_student_enrolled,
    unenroll_student_to_subject,
    get_all_students,
    get_student_by_id,
    create_student,
    get_student_subjects,
    get_student_attendance,
    create_attendance,
)
from src.pipelines.face_pipeline import (
    build_candidate_map,
    choose_best_face_match,
    get_face_embeddings,
    predict_attendance,
    train_classifier,
    validate_registration_face,
)
from src.utils.pdf_generator import generate_attendance_pdf
from src.pipelines.voice_pipeline import get_voice_embedding, process_bulk_audio

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
logger = logging.getLogger(__name__)

app = Flask(
    __name__,
    template_folder=os.path.join(BASE_DIR, "templates"),
    static_folder=os.path.join(BASE_DIR, "static"),
)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "dev-secret-change-me-in-prod")
app.config["MAX_CONTENT_LENGTH"] = 32 * 1024 * 1024  # 32MB, group photos add up

APP_DOMAIN = os.environ.get("APP_DOMAIN", "http://localhost:5000")



ALLOWED_IMAGE_MIME_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
}


def decode_data_url_image(data_url, max_dimension=1600):
    """Decode a browser image into an EXIF-corrected, bounded RGB NumPy array."""
    if not isinstance(data_url, str) or not data_url.strip():
        raise ValueError("Invalid or empty image data")

    encoded_data = data_url
    if data_url.startswith("data:"):
        header, separator, encoded_data = data_url.partition(",")
        if not separator or ";base64" not in header.lower():
            raise ValueError("Image must be a base64 data URL")
        mime_type = header[5:].split(";", 1)[0].lower()
        if mime_type not in ALLOWED_IMAGE_MIME_TYPES:
            raise ValueError("Unsupported image format. Use JPEG, PNG, or WebP.")

    try:
        raw = base64.b64decode(encoded_data, validate=True)
        image = Image.open(io.BytesIO(raw))
        image = ImageOps.exif_transpose(image).convert("RGB")
        image.thumbnail((max_dimension, max_dimension), Image.Resampling.LANCZOS)
        image.load()
    except (ValueError, binascii.Error, UnidentifiedImageError, OSError) as exc:
        raise ValueError("The uploaded image is corrupted or unsupported") from exc

    return np.asarray(image), image


def optimize_attendance_image(data_url, max_dimension=1600):
    """Decode and downsample oversized uploads while preserving face detail."""
    image_np, _ = decode_data_url_image(data_url, max_dimension=max_dimension)
    return image_np


@app.errorhandler(413)
def request_entity_too_large(_error):
    return jsonify({"ok": False, "success": False, "error": "Uploaded image data is too large"}), 413


def decode_data_url_bytes(data_url):
    if "," in data_url:
        data_url = data_url.split(",", 1)[1]
    return base64.b64decode(data_url)


def current_student():
    sid = session.get("student_id")
    if not sid:
        return None
    return get_student_by_id(sid)


def current_teacher():
    tid = session.get("teacher_id")
    if not tid:
        return None
    return get_teacher_by_id(tid)


def resolve_join_subject(code=None, subject_id=None):
    if subject_id is not None:
        return get_subject_by_id(subject_id)
    if not code:
        return None
    code = str(code).strip()
    if not code:
        return None
    return get_subject_by_code(code)


@app.route("/")
def home():
    return render_template("home.html")


@app.route("/student")
def student_page():
    student = current_student()
    join_code = (request.args.get("join-code") or "").strip()
    subject = resolve_join_subject(code=join_code) if join_code else None
    if subject:
        session["pending_join_subject_id"] = subject["subject_id"]
        session["pending_join_code"] = join_code
    if student:
        return render_template("student_dashboard.html", student=student, join_subject=subject)
    return render_template("student_auth.html", subject=subject, join_code=join_code)


@app.route("/teacher")
def teacher_page():
    teacher = current_teacher()
    if teacher:
        return render_template("teacher_dashboard.html", teacher=teacher)
    return render_template("teacher_auth.html")



@app.route("/api/student/face-login", methods=["POST"])
def api_student_face_login():
    data = request.get_json(force=True)
    image_data_url = data.get("image")
    if not image_data_url:
        return jsonify({"ok": False, "error": "No image supplied"}), 400

    img_np, _ = decode_data_url_image(image_data_url)

    detected, all_ids, num_faces = predict_attendance(img_np)

    if num_faces == 0:
        return jsonify({"ok": False, "error": "no_face", "message": "Face not found!"})
    if num_faces > 1:
        return jsonify({"ok": False, "error": "multi_face", "message": "Multiple faces found"})

    if detected:
        student_id = list(detected.keys())[0]
        student = get_student_by_id(student_id)
        if student:
            session["student_id"] = student["student_id"]
            return jsonify({"ok": True, "recognized": True, "student": student})

    return jsonify({"ok": True, "recognized": False, "message": "Face not recognized! You might be a new student."})


@app.route("/api/student/register", methods=["POST"])
def api_student_register():
    data = request.get_json(force=True)
    name = (data.get("name") or "").strip()
    image_data_url = data.get("image")
    audio_data_url = data.get("audio")
    join_code = (data.get("join_code") or "").strip()
    subject_id = data.get("subject_id")

    if not name:
        return jsonify({"ok": False, "error": "Please enter your name"}), 400
    if not image_data_url:
        return jsonify({"ok": False, "error": "Missing face photo"}), 400

    img_np, _ = decode_data_url_image(image_data_url)
    validation = validate_registration_face(img_np)
    if not validation["ok"]:
        return jsonify({"ok": False, "error": validation["message"]}), 400

    detection = get_face_embeddings(img_np)
    if not detection:
        return jsonify({"ok": False, "error": "No face detected. Please try again."}), 400
    if len(detection) > 1:
        return jsonify({"ok": False, "error": "Please make sure only one person is visible."}), 400

    subject = resolve_join_subject(code=join_code, subject_id=subject_id)
    if join_code and not subject:
        return jsonify({"ok": False, "error": "Invalid or expired join link"}), 400
    if subject_id is not None and not subject:
        return jsonify({"ok": False, "error": "Subject not found"}), 404

    if subject is not None:
        session["pending_join_subject_id"] = subject["subject_id"]
        session["pending_join_code"] = join_code or subject["subject_code"]

    face_emb = detection[0].tolist()

    voice_emb = None
    if audio_data_url:
        audio_bytes = decode_data_url_bytes(audio_data_url)
        voice_emb = get_voice_embedding(audio_bytes)

    existing_match = choose_best_face_match(np.asarray(face_emb, dtype=float), build_candidate_map())
    if existing_match:
        existing_student = get_student_by_id(existing_match["student_id"])
        if existing_student and subject is not None:
            if not is_student_enrolled(existing_student["student_id"], subject["subject_id"]):
                enroll_student_to_subject(existing_student["student_id"], subject["subject_id"])
        session["student_id"] = existing_student["student_id"]
        session.pop("pending_join_subject_id", None)
        session.pop("pending_join_code", None)
        return jsonify({"ok": True, "student": existing_student, "subject": subject, "duplicate_student": True})

    response_data = create_student(name, face_embedding=face_emb, voice_embedding=voice_emb)
    if not response_data:
        return jsonify({"ok": False, "error": "Could not create profile, please try again"}), 500

    student = response_data[0]
    if subject is not None:
        if is_student_enrolled(student["student_id"], subject["subject_id"]):
            return jsonify({"ok": False, "error": "You are already enrolled in this subject"}), 400
        enroll_student_to_subject(student["student_id"], subject["subject_id"])
    session["student_id"] = student["student_id"]
    session.pop("pending_join_subject_id", None)
    session.pop("pending_join_code", None)
    return jsonify({"ok": True, "student": student, "subject": subject})


@app.route("/api/student/logout", methods=["POST"])
def api_student_logout():
    session.pop("student_id", None)
    return jsonify({"ok": True})


@app.route("/api/student/subjects", methods=["GET"])
def api_student_subjects():
    student = current_student()
    if not student:
        return jsonify({"ok": False, "error": "Not logged in"}), 401

    student_id = student["student_id"]
    subjects = get_student_subjects(student_id)
    logs = get_student_attendance(student_id)

    stats_map = {}
    for log in logs:
        sid = log["subject_id"]
        stats_map.setdefault(sid, {"total": 0, "attended": 0})
        stats_map[sid]["total"] += 1
        if log.get("is_present"):
            stats_map[sid]["attended"] += 1

    result = []
    for node in subjects:
        sub = node["subjects"]
        sid = sub["subject_id"]
        stats = stats_map.get(sid, {"total": 0, "attended": 0})
        result.append(
            {
                "subject_id": sid,
                "name": sub["name"],
                "subject_code": sub["subject_code"],
                "section": sub["section"],
                "total": stats["total"],
                "attended": stats["attended"],
            }
        )

    return jsonify({"ok": True, "subjects": result})


@app.route("/api/student/enroll", methods=["POST"])
def api_student_enroll():
    student = current_student()
    if not student:
        return jsonify({"ok": False, "error": "Not logged in"}), 401

    data = request.get_json(force=True)
    join_code = (data.get("join_code") or "").strip()
    if not join_code:
        return jsonify({"ok": False, "error": "Please enter a subject code"}), 400

    subject = get_subject_by_code(join_code)
    if not subject:
        return jsonify({"ok": False, "error": "Subject code not found"}), 404

    if is_student_enrolled(student["student_id"], subject["subject_id"]):
        return jsonify({"ok": False, "error": "You are already enrolled in this program"}), 400

    enroll_student_to_subject(student["student_id"], subject["subject_id"])
    return jsonify({"ok": True, "subject": subject})


@app.route("/api/student/unenroll", methods=["POST"])
def api_student_unenroll():
    student = current_student()
    if not student:
        return jsonify({"ok": False, "error": "Not logged in"}), 401

    data = request.get_json(force=True)
    subject_id = data.get("subject_id")
    unenroll_student_to_subject(student["student_id"], subject_id)
    return jsonify({"ok": True})


@app.route("/api/student/join-info")
def api_student_join_info():
    code = (request.args.get("code") or "").strip()
    subject = resolve_join_subject(code=code)
    if not subject:
        return jsonify({"ok": False, "error": "Invalid or expired join link"}), 404

    student = current_student()
    already_enrolled = False
    if student:
        already_enrolled = is_student_enrolled(student["student_id"], subject["subject_id"])

    return jsonify({"ok": True, "subject": subject, "already_enrolled": already_enrolled})



@app.route("/api/teacher/login", methods=["POST"])
def api_teacher_login():
    data = request.get_json(force=True)
    username = data.get("username")
    password = data.get("password")

    if not username or not password:
        return jsonify({"ok": False, "error": "Please fill in both fields"}), 400

    teacher = teacher_login(username, password)
    if not teacher:
        return jsonify({"ok": False, "error": "Invalid username or password"}), 401

    session["teacher_id"] = teacher["teacher_id"]
    return jsonify({"ok": True, "teacher": teacher})


@app.route("/api/teacher/register", methods=["POST"])
def api_teacher_register():
    data = request.get_json(force=True)
    username = data.get("username")
    password = data.get("password")
    confirm = data.get("confirm")
    name = data.get("name")

    if not username or not password or not confirm or not name:
        return jsonify({"ok": False, "error": "Please fill all the fields"}), 400
    if check_teacher_exists(username):
        return jsonify({"ok": False, "error": "Username already exists"}), 400
    if password != confirm:
        return jsonify({"ok": False, "error": "Passwords do not match"}), 400

    try:
        create_teacher(username, password, name)
        return jsonify({"ok": True, "message": "Successfully registered, please login to continue"})
    except Exception:
        return jsonify({"ok": False, "error": "Unexpected error occurred"}), 500


@app.route("/api/teacher/logout", methods=["POST"])
def api_teacher_logout():
    session.pop("teacher_id", None)
    return jsonify({"ok": True})


@app.route("/api/teacher/subjects", methods=["GET"])
def api_teacher_subjects_list():
    teacher = current_teacher()
    if not teacher:
        return jsonify({"ok": False, "error": "Not logged in"}), 401
    subjects = get_teacher_subjects(teacher["teacher_id"])
    return jsonify({"ok": True, "subjects": subjects})


@app.route("/api/teacher/subjects", methods=["POST"])
def api_teacher_subjects_create():
    teacher = current_teacher()
    if not teacher:
        return jsonify({"ok": False, "error": "Not logged in"}), 401

    data = request.get_json(force=True)
    code = (data.get("subject_code") or "").strip()
    name = (data.get("name") or "").strip()
    section = (data.get("section") or "").strip()

    if not (code and name and section):
        return jsonify({"ok": False, "error": "Please fill all the fields"}), 400

    try:
        result = create_subject(code, name, section, teacher["teacher_id"])
        return jsonify({"ok": True, "subject": result[0] if result else None})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/teacher/subjects/<code>/share")
def api_teacher_subject_share(code):
    teacher = current_teacher()
    if not teacher:
        return jsonify({"ok": False, "error": "Not logged in"}), 401

    join_url = f"{APP_DOMAIN}/student?join-code={code}"
    qr = segno.make(join_url)
    out = io.BytesIO()
    qr.save(out, kind="png", scale=8, border=1)
    qr_base64 = base64.b64encode(out.getvalue()).decode()

    return jsonify({"ok": True, "url": join_url, "code": code, "qr_base64": qr_base64})


@app.route("/api/teacher/attendance/photos/analyze", methods=["POST"])
def api_teacher_photos_analyze():
    teacher = current_teacher()
    if not teacher:
        return jsonify({"ok": False, "success": False, "error": "Not logged in"}), 401

    try:
        data = request.get_json(silent=True) or {}
        subject_id = data.get("subject_id")
        images = data.get("images", [])

        if not images:
            return jsonify({"ok": False, "success": False, "error": "No photos supplied"}), 400
        if not subject_id:
            return jsonify({"ok": False, "success": False, "error": "Missing subject ID"}), 400
        if not isinstance(images, list):
            return jsonify({"ok": False, "success": False, "error": "Invalid image list"}), 400

        enrolled_students = get_subject_enrolled_students(subject_id)
        if not enrolled_students:
            return jsonify({"ok": False, "success": False, "error": "No students enrolled in this course"}), 400

        student_records = [node["students"] for node in enrolled_students if node.get("students")]
        candidate_map = build_candidate_map(student_records=student_records)
        all_detected_ids = {}
        unknown_faces = 0
        timings = {"image_loading_ms": 0.0, "face_detection_ms": 0.0, "face_matching_ms": 0.0}
        total_started = time.perf_counter()
        for idx, image_data_url in enumerate(images):
            loading_started = time.perf_counter()
            img_np = optimize_attendance_image(image_data_url)
            timings["image_loading_ms"] += (time.perf_counter() - loading_started) * 1000
            detection_started = time.perf_counter()
            detected, _, _, face_details = predict_attendance(
                img_np,
                threshold=0.45,
                min_margin=0.05,
                candidate_map=candidate_map,
                return_details=True,
            )
            detection_elapsed = (time.perf_counter() - detection_started) * 1000
            timings["face_detection_ms"] += detection_elapsed
            timings["face_matching_ms"] += detection_elapsed
            unknown_faces += sum(1 for detail in face_details if detail["decision"] == "UNKNOWN")
            for sid in detected.keys():
                student_id = int(sid)
                all_detected_ids.setdefault(student_id, []).append(f"Photo {idx + 1}")

        results, attendance_to_log = [], []
        current_timestamp = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
        for node in enrolled_students:
            student = node["students"]
            sources = all_detected_ids.get(int(student["student_id"]), [])
            is_present = len(sources) > 0
            results.append(
                {
                    "name": student["name"],
                    "id": student["student_id"],
                    "source": ", ".join(sources) if is_present else "-",
                    "present": is_present,
                }
            )
            attendance_to_log.append(
                {
                    "student_id": student["student_id"],
                    "subject_id": subject_id,
                    "timestamp": current_timestamp,
                    "is_present": bool(is_present),
                }
            )

        unique_logs = []
        seen = set()
        for log in attendance_to_log:
            key = (int(log["student_id"]), int(log["subject_id"]), str(log["timestamp"]))
            if key in seen:
                continue
            seen.add(key)
            unique_logs.append(log)

        timings["total_ms"] = (time.perf_counter() - total_started) * 1000
        logger.info("[ATTENDANCE PERFORMANCE] %s", {key: round(value, 2) for key, value in timings.items()})
        return jsonify({"ok": True, "success": True, "results": results, "logs": unique_logs, "unknown_faces": unknown_faces, "timings": timings})
    except Exception as exc:
        logger.exception("Face attendance analysis failed")
        return jsonify({"ok": False, "success": False, "error": str(exc) or "Face analysis failed"}), 500


@app.route("/api/teacher/attendance/voice/analyze", methods=["POST"])
def api_teacher_voice_analyze():
    teacher = current_teacher()
    if not teacher:
        return jsonify({"ok": False, "error": "Not logged in"}), 401

    data = request.get_json(force=True)
    subject_id = data.get("subject_id")
    audio_data_url = data.get("audio")

    if not audio_data_url:
        return jsonify({"ok": False, "error": "No audio supplied"}), 400

    enrolled_students = get_subject_enrolled_students(subject_id)
    if not enrolled_students:
        return jsonify({"ok": False, "error": "No students enrolled in this course"}), 400

    candidates_dict = {
        s["students"]["student_id"]: s["students"]["voice_embedding"]
        for s in enrolled_students
        if s["students"].get("voice_embedding")
    }

    if not candidates_dict:
        return jsonify({"ok": False, "error": "No enrolled students have voice profiles registered"}), 400

    audio_bytes = decode_data_url_bytes(audio_data_url)
    detected_scores = process_bulk_audio(audio_bytes, candidates_dict)

    results, attendance_to_log = [], []
    current_timestamp = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")

    for node in enrolled_students:
        student = node["students"]
        score = detected_scores.get(student["student_id"], 0.0)
        is_present = bool(score > 0)

        results.append(
            {
                "name": student["name"],
                "id": student["student_id"],
                "source": f"{score:.0%}" if is_present else "-",
                "present": is_present,
            }
        )
        attendance_to_log.append(
            {
                "student_id": student["student_id"],
                "subject_id": subject_id,
                "timestamp": current_timestamp,
                "is_present": bool(is_present),
            }
        )

    return jsonify({"ok": True, "results": results, "logs": attendance_to_log})


@app.route("/api/teacher/attendance/confirm", methods=["POST"])
def api_teacher_attendance_confirm():
    teacher = current_teacher()
    if not teacher:
        return jsonify({"ok": False, "error": "Not logged in"}), 401

    data = request.get_json(force=True)
    logs = data.get("logs", [])
    if not logs:
        return jsonify({"ok": False, "error": "Nothing to save"}), 400

    save_started = time.perf_counter()
    try:
        existing_session = get_attendance_session_for_teacher(teacher["teacher_id"], str(logs[0].get("timestamp")))
        if existing_session:
            return jsonify({"ok": False, "error": "This attendance session was already saved."}), 409
        create_attendance(logs)
        session_id = str(logs[0].get("timestamp"))
        logger.info("[ATTENDANCE PERFORMANCE] database_saving_ms=%.2f", (time.perf_counter() - save_started) * 1000)
        return jsonify({"ok": True, "session_id": session_id})
    except Exception:
        return jsonify({"ok": False, "error": "Sync failed!"}), 500


@app.route("/api/teacher/attendance/records")
def api_teacher_attendance_records():
    teacher = current_teacher()
    if not teacher:
        return jsonify({"ok": False, "error": "Not logged in"}), 401

    records = get_attendance_for_teacher(teacher["teacher_id"])
    if not records:
        return jsonify({"ok": True, "records": []})

    grouped = {}
    for r in records:
        ts = r.get("timestamp")
        ts_group = ts.split(".")[0] if ts else "unknown"
        key = (ts_group, r["subjects"]["name"], r["subjects"]["subject_code"])
        grouped.setdefault(key, {"total": 0, "present": 0})
        grouped[key]["total"] += 1
        if r.get("is_present"):
            grouped[key]["present"] += 1

    rows = []
    for (ts_group, subject_name, subject_code), stats in grouped.items():
        try:
            time_label = datetime.fromisoformat(ts_group).strftime("%Y-%m-%d %I:%M %p")
        except ValueError:
            time_label = ts_group
        rows.append(
            {
                "time": time_label,
                "ts_group": ts_group,
                "subject": subject_name,
                "subject_code": subject_code,
                "present": stats["present"],
                "total": stats["total"],
            }
        )

    rows.sort(key=lambda r: r["ts_group"], reverse=True)
    return jsonify({"ok": True, "records": rows})


@app.route("/download-attendance-pdf/<path:session_id>")
def download_attendance_pdf(session_id):
    teacher = current_teacher()
    if not teacher:
        return jsonify({"ok": False, "error": "Not logged in"}), 401

    records = get_attendance_session_for_teacher(teacher["teacher_id"], session_id)
    if not records:
        return jsonify({"ok": False, "error": "Attendance session not found"}), 404

    subject = records[0].get("subjects") or {}
    pdf_buffer = generate_attendance_pdf(
        session_id=session_id,
        teacher=teacher,
        subject=subject,
        records=records,
        unknown_faces=0,
    )
    date_label = session_id[:10] if len(session_id) >= 10 else datetime.now().strftime("%Y-%m-%d")
    code = subject.get("subject_code", "Report")
    filename = f"SnapAI_Attendance_{code}_{date_label}.pdf"
    return send_file(pdf_buffer, as_attachment=True, download_name=filename, mimetype="application/pdf")


@app.route("/download-attendance-export/<export_format>/<path:session_id>")
def download_attendance_export(export_format, session_id):
    teacher = current_teacher()
    if not teacher:
        return jsonify({"ok": False, "error": "Not logged in"}), 401
    if export_format not in {"csv", "xlsx"}:
        return jsonify({"ok": False, "error": "Unsupported export format"}), 400

    records = get_attendance_session_for_teacher(teacher["teacher_id"], session_id)
    if not records:
        return jsonify({"ok": False, "error": "Attendance session not found"}), 404
    rows = []
    for record in records:
        student = record.get("students") or {}
        rows.append({
            "Student ID": student.get("student_id", record.get("student_id", "")),
            "Student Name": student.get("name", ""),
            "Status": "Present" if record.get("is_present") else "Absent",
            "Timestamp": record.get("timestamp", session_id),
        })

    output = io.BytesIO()
    code = (records[0].get("subjects") or {}).get("subject_code", "Report")
    date_label = session_id[:10]
    if export_format == "csv":
        text_buffer = io.StringIO()
        writer = csv.DictWriter(text_buffer, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)
        output.write(text_buffer.getvalue().encode("utf-8"))
        mimetype, extension = "text/csv", "csv"
    else:
        import pandas as pd
        pd.DataFrame(rows).to_excel(output, index=False, engine="openpyxl")
        mimetype, extension = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"
    output.seek(0)
    return send_file(output, as_attachment=True, download_name=f"SnapAI_Attendance_{code}_{date_label}.{extension}", mimetype=mimetype)


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
