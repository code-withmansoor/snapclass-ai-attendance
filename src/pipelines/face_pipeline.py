import logging
import os

import dlib
import face_recognition_models
import numpy as np

from src.database.db import get_all_students, get_subject_enrolled_students

logger = logging.getLogger(__name__)

FACE_MATCH_THRESHOLD = float(os.environ.get("FACE_MATCH_THRESHOLD", "0.45"))
FACE_MATCH_MIN_MARGIN = float(os.environ.get("FACE_MATCH_MIN_MARGIN", "0.05"))

_dlib_models = None


def load_dlib_models():
    global _dlib_models
    if _dlib_models is None:
        detector = dlib.get_frontal_face_detector()
        sp = dlib.shape_predictor(face_recognition_models.pose_predictor_model_location())
        facerec = dlib.face_recognition_model_v1(face_recognition_models.face_recognition_model_location())
        _dlib_models = (detector, sp, facerec)
    return _dlib_models


def _coerce_embedding(raw_value):
    if raw_value is None:
        return None
    arr = np.asarray(raw_value, dtype=float)
    if arr.size != 128 or arr.ndim != 1:
        return None
    return arr.astype(float)


def normalize_student_embeddings(student_record):
    raw_embedding = student_record.get("face_embedding")
    if raw_embedding is None:
        return []
    if isinstance(raw_embedding, list) and raw_embedding and isinstance(raw_embedding[0], (list, tuple, np.ndarray)):
        embeddings = []
        for item in raw_embedding:
            emb = _coerce_embedding(item)
            if emb is not None:
                embeddings.append(emb)
        return embeddings
    emb = _coerce_embedding(raw_embedding)
    return [emb] if emb is not None else []


def get_face_embeddings(image_np):
    detector, sp, facerec = load_dlib_models()
    faces = detector(image_np, 1)
    encodings = []

    for face in faces:
        shape = sp(image_np, face)
        face_descriptor = facerec.compute_face_descriptor(image_np, shape, 1)
        embedding = np.array(face_descriptor, dtype=float)
        encodings.append(embedding)
    return encodings


def validate_registration_face(image_np):
    detector, _, _ = load_dlib_models()
    faces = detector(image_np, 1)

    if len(faces) == 0:
        return {"ok": False, "message": "No face detected. Please try again."}
    if len(faces) > 1:
        return {"ok": False, "message": "Please make sure only one person is visible."}

    face = faces[0]
    height, width = image_np.shape[:2]
    face_width = face.right() - face.left()
    face_height = face.bottom() - face.top()
    face_center_x = (face.left() + face.right()) / 2
    face_center_y = (face.top() + face.bottom()) / 2

    if face_width < 80 or face_height < 80:
        return {"ok": False, "message": "Please move closer to the camera and try again."}
    if abs(face_center_x - (width / 2)) / width > 0.35 or abs(face_center_y - (height / 2)) / height > 0.35:
        return {"ok": False, "message": "Please center your face in the frame."}

    gray = np.dot(image_np[..., :3], [0.299, 0.587, 0.114]).astype(np.float32)
    blur_score = float(np.var(gray))
    if blur_score < 40:
        return {"ok": False, "message": "The image is too blurry. Please try again."}

    return {"ok": True, "message": "Face looks usable."}


def build_candidate_map(subject_id=None, subject_student_ids=None):
    if subject_id is not None:
        student_rows = get_subject_enrolled_students(subject_id)
        students = [node.get("students") for node in student_rows if node.get("students")]
    else:
        students = get_all_students()

    if subject_student_ids:
        subject_student_ids = {int(sid) for sid in subject_student_ids}
        students = [student for student in students if int(student["student_id"]) in subject_student_ids]

    candidate_map = {}
    for student in students:
        student_id = student.get("student_id")
        if student_id is None:
            continue
        embeddings = normalize_student_embeddings(student)
        if embeddings:
            candidate_map[int(student_id)] = embeddings
    return candidate_map


def _distance_between(a, b):
    return float(np.linalg.norm(np.asarray(a, dtype=float) - np.asarray(b, dtype=float)))


def choose_best_face_match(detected_embedding, candidate_embeddings, threshold=None, min_margin=None):
    threshold = FACE_MATCH_THRESHOLD if threshold is None else float(threshold)
    min_margin = FACE_MATCH_MIN_MARGIN if min_margin is None else float(min_margin)

    candidate_scores = []
    for student_id, embeddings in candidate_embeddings.items():
        for emb in embeddings:
            distance = _distance_between(detected_embedding, emb)
            candidate_scores.append((student_id, distance))

    if not candidate_scores:
        return None

    best_student_id, best_distance = min(candidate_scores, key=lambda item: item[1])
    second_best_distance = min(
        (distance for student_id, distance in candidate_scores if student_id != best_student_id),
        default=None,
    )

    if best_distance > threshold:
        return None
    if second_best_distance is not None and (second_best_distance - best_distance) < min_margin:
        return None

    return {
        "student_id": int(best_student_id),
        "distance": float(best_distance),
        "second_best_distance": float(second_best_distance) if second_best_distance is not None else None,
        "threshold": threshold,
    }


def predict_attendance(class_image_np, subject_id=None, subject_student_ids=None, threshold=None, min_margin=None):
    encodings = get_face_embeddings(class_image_np)
    if not encodings:
        return {}, [], 0

    threshold = FACE_MATCH_THRESHOLD if threshold is None else float(threshold)
    min_margin = FACE_MATCH_MIN_MARGIN if min_margin is None else float(min_margin)

    candidate_map = build_candidate_map(subject_id=subject_id, subject_student_ids=subject_student_ids)
    logger.info("[FACE DETECTION] Detected faces: %s", len(encodings))

    detected_students = {}
    face_details = []
    for face_index, encoding in enumerate(encodings, 1):
        candidate_scores = []
        for student_id, embeddings in candidate_map.items():
            for emb in embeddings:
                candidate_scores.append((student_id, _distance_between(encoding, emb)))

        sorted_candidates = sorted(candidate_scores, key=lambda item: item[1])
        logger.info("[FACE MATCH] Face #%s", face_index)
        for student_id, distance in sorted_candidates[:10]:
            logger.info("Candidate: %s Distance: %.4f", student_id, distance)
        logger.info("Threshold: %.4f", threshold)

        match_result = choose_best_face_match(encoding, candidate_map, threshold=threshold, min_margin=min_margin)
        if match_result:
            detected_students[int(match_result["student_id"])] = {
                "distance": match_result["distance"],
                "threshold": threshold,
                "status": "MATCH",
            }
            logger.info("Decision: %s -> MATCH", match_result["student_id"])
            face_details.append({"face_index": face_index, "student_id": match_result["student_id"], "distance": match_result["distance"], "decision": "MATCH"})
        else:
            logger.info("Decision: UNKNOWN")
            face_details.append({"face_index": face_index, "student_id": None, "distance": None, "decision": "UNKNOWN"})

    return detected_students, list(candidate_map.keys()), len(encodings)


def train_classifier():
    return True
