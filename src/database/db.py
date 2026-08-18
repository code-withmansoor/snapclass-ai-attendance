from src.database.config import supabase
import bcrypt


def hash_pass(pwd):
    return bcrypt.hashpw(pwd.encode(), bcrypt.gensalt()).decode()


def check_pass(pwd, hashed):
    return bcrypt.checkpw(pwd.encode(), hashed.encode())


def check_teacher_exists(username):
    response = supabase.table("teachers").select("username").eq("username", username).execute()
    return len(response.data) > 0


def create_teacher(username, password, name):
    data = {"username": username, "password": hash_pass(password), "name": name}
    response = supabase.table("teachers").insert(data).execute()
    return response.data


def teacher_login(username, password):
    response = supabase.table("teachers").select("*").eq("username", username).execute()
    if response.data:
        teacher = response.data[0]
        if check_pass(password, teacher["password"]):
            return teacher
    return None


def get_teacher_by_id(teacher_id):
    response = supabase.table("teachers").select("*").eq("teacher_id", teacher_id).execute()
    return response.data[0] if response.data else None


def get_all_students():
    response = supabase.table("students").select("*").execute()
    return response.data


def get_student_by_id(student_id):
    response = supabase.table("students").select("*").eq("student_id", student_id).execute()
    return response.data[0] if response.data else None


def create_student(new_name, face_embedding=None, voice_embedding=None):
    data = {"name": new_name, "face_embedding": face_embedding, "voice_embedding": voice_embedding}
    response = supabase.table("students").insert(data).execute()
    return response.data


def create_subject(subject_code, name, section, teacher_id):
    data = {"subject_code": subject_code, "name": name, "section": section, "teacher_id": teacher_id}
    response = supabase.table("subjects").insert(data).execute()
    return response.data


def get_teacher_subjects(teacher_id):
    response = (
        supabase.table("subjects")
        .select("*, subject_students(count), attendance_logs(timestamp)")
        .eq("teacher_id", teacher_id)
        .execute()
    )
    subjects = response.data

    for sub in subjects:
        sub["total_students"] = (
            sub.get("subject_students", [{}])[0].get("count", 0) if sub.get("subject_students") else 0
        )
        attendance = sub.get("attendance_logs", [])
        unique_sessions = len(set(log["timestamp"] for log in attendance))
        sub["total_classes"] = unique_sessions

        sub.pop("subject_students", None)
        sub.pop("attendance_logs", None)

    return subjects


def get_subject_by_id(subject_id):
    response = (
        supabase.table("subjects")
        .select("subject_id, name, subject_code, section, teacher_id")
        .eq("subject_id", subject_id)
        .execute()
    )
    return response.data[0] if response.data else None


def get_subject_by_code(subject_code):
    if subject_code is None:
        return None
    code = str(subject_code).strip()
    if not code:
        return None
    response = (
        supabase.table("subjects")
        .select("subject_id, name, subject_code, section, teacher_id")
        .eq("subject_code", code)
        .execute()
    )
    return response.data[0] if response.data else None


def get_subject_enrolled_students(subject_id):
    response = supabase.table("subject_students").select("*, students(*)").eq("subject_id", subject_id).execute()
    return response.data


def enroll_student_to_subject(student_id, subject_id):
    if not student_id or not subject_id:
        return None
    if is_student_enrolled(student_id, subject_id):
        return []
    data = {"student_id": student_id, "subject_id": subject_id}
    response = supabase.table("subject_students").insert(data).execute()
    return response.data


def is_student_enrolled(student_id, subject_id):
    response = (
        supabase.table("subject_students")
        .select("*")
        .eq("subject_id", subject_id)
        .eq("student_id", student_id)
        .execute()
    )
    return bool(response.data)


def unenroll_student_to_subject(student_id, subject_id):
    response = (
        supabase.table("subject_students")
        .delete()
        .eq("student_id", student_id)
        .eq("subject_id", subject_id)
        .execute()
    )
    return response.data


def get_student_subjects(student_id):
    response = supabase.table("subject_students").select("*, subjects(*)").eq("student_id", student_id).execute()
    return response.data


def get_student_attendance(student_id):
    response = supabase.table("attendance_logs").select("*, subjects(*)").eq("student_id", student_id).execute()
    return response.data


def deduplicate_attendance_logs(logs):
    seen = set()
    deduped = []
    for log in logs or []:
        if not log:
            continue
        student_id = log.get("student_id")
        subject_id = log.get("subject_id")
        timestamp = log.get("timestamp")
        if student_id is None or subject_id is None or timestamp is None:
            deduped.append(log)
            continue
        key = (int(student_id), int(subject_id), str(timestamp))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(log)
    return deduped


def create_attendance(logs):
    filtered_logs = deduplicate_attendance_logs(logs)
    response = supabase.table("attendance_logs").insert(filtered_logs).execute()
    return response.data


def get_attendance_for_teacher(teacher_id):
    response = (
        supabase.table("attendance_logs")
        .select("*, subjects!inner(*)")
        .eq("subjects.teacher_id", teacher_id)
        .execute()
    )
    return response.data
