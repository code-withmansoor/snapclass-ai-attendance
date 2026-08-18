import unittest

import numpy as np

from src.database.db import deduplicate_attendance_logs
from src.pipelines.face_pipeline import choose_best_face_match


class FaceMatchingTests(unittest.TestCase):
    def test_choose_best_face_match_accepts_good_match(self):
        target = np.zeros(128, dtype=float)
        close_match = np.full(128, 0.01, dtype=float)
        second_match = np.full(128, 0.5, dtype=float)

        result = choose_best_face_match(
            np.zeros(128, dtype=float),
            {
                101: [close_match],
                202: [second_match],
            },
            threshold=0.45,
            min_margin=0.05,
        )

        self.assertIsNotNone(result)
        self.assertEqual(result["student_id"], 101)
        self.assertLess(result["distance"], 0.45)

    def test_choose_best_face_match_rejects_ambiguous_match(self):
        emb = np.zeros(128, dtype=float)
        best = np.full(128, 0.04, dtype=float)
        second = np.full(128, 0.045, dtype=float)

        result = choose_best_face_match(
            emb,
            {
                101: [best],
                202: [second],
            },
            threshold=0.45,
            min_margin=0.1,
        )

        self.assertIsNone(result)

    def test_deduplicate_attendance_logs(self):
        logs = [
            {"student_id": 1, "subject_id": 7, "timestamp": "2026-08-18T09:00:00", "is_present": True},
            {"student_id": 1, "subject_id": 7, "timestamp": "2026-08-18T09:00:00", "is_present": True},
            {"student_id": 2, "subject_id": 7, "timestamp": "2026-08-18T09:00:00", "is_present": True},
            {"student_id": 1, "subject_id": 7, "timestamp": "2026-08-18T09:30:00", "is_present": True},
        ]

        deduped = deduplicate_attendance_logs(logs)
        self.assertEqual(len(deduped), 3)
        self.assertEqual({row["student_id"] for row in deduped}, {1, 2})


if __name__ == "__main__":
    unittest.main()
