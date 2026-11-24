"""Voce neurale italiana gia caricata. Una riga JSON in ingresso, una in uscita."""
import json
import sys

from piper import PiperVoice

voice = PiperVoice.load(sys.argv[1])
sys.stderr.write("ready\n")
sys.stderr.flush()

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        text = json.loads(line).get("text", "")
        chunks: list[bytes] = []
        rate = 22050
        for chunk in voice.synthesize(text):
            chunks.append(chunk.audio_int16_bytes)
            rate = chunk.sample_rate
        audio = b"".join(chunks)
        sys.stdout.write(json.dumps({"ok": True, "rate": rate, "pcm": audio.hex()}) + "\n")
    except Exception as error:
        sys.stdout.write(json.dumps({"ok": False, "error": str(error)}) + "\n")
    sys.stdout.flush()
