import json

data = json.load(open('public/data/maritime_communication_v1.json', encoding='utf-8'))
with open('temp_inspect.txt', 'w', encoding='utf-8') as f:
    for w in data['words']:
        f.write(f"ID: {w['id']}\nEN: {w['word']}\nKR: {w['meaning'][0]}\nDIS: {w.get('distractors', [])}\n\n")

print(f"Dumped {len(data['words'])} items.")
