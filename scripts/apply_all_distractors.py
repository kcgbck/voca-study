# -*- coding: utf-8 -*-
"""
150개 전 문항의 고난도 오답(distractors)을 maritime_communication_v1.json에 반영하고 무결성을 검증하는 스크립트
"""

import json
import os
import sys

from distractors_part1 import ADVANCED_DISTRACTORS as part1
from distractors_part2 import ADVANCED_DISTRACTORS_PART2 as part2
from distractors_part3 import ADVANCED_DISTRACTORS_PART3 as part3

def main():
    combined = {}
    combined.update(part1)
    combined.update(part2)
    combined.update(part3)

    print(f"Total distractor keys combined: {len(combined)}")
    assert len(combined) == 150, f"Expected 150 items, but got {len(combined)}"

    for i in range(1, 151):
        assert i in combined, f"Missing id: {i}"
        assert len(combined[i]) == 3, f"Item {i} does not have exactly 3 distractors"
        # Check no duplicates among the 3 distractors
        assert len(set(combined[i])) == 3, f"Item {i} has duplicate distractors: {combined[i]}"

    json_path = os.path.join(os.path.dirname(__file__), "..", "public", "data", "maritime_communication_v1.json")
    json_path = os.path.abspath(json_path)

    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    words = data.get("words", [])
    assert len(words) == 150, f"Expected 150 words in json, but got {len(words)}"

    updated_count = 0
    for word in words:
        wid = word["id"]
        assert wid in combined, f"Word ID {wid} not in combined distractors"

        correct_meaning = word["meaning"][0].strip()
        new_distractors = [d.strip() for d in combined[wid]]

        # Ensure correct meaning is not in distractors
        for d in new_distractors:
            assert d != correct_meaning, f"Conflict in ID {wid}: distractor '{d}' equals correct meaning '{correct_meaning}'"

        word["distractors"] = new_distractors
        updated_count += 1

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"Successfully updated {updated_count} items with advanced distractors!")

if __name__ == "__main__":
    main()
