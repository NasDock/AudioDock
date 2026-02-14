import os
import tempfile
from fastapi import FastAPI, UploadFile, File, HTTPException
from faster_whisper import WhisperModel
import uvicorn
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="SoundX ASR Service")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize faster-whisper model
# Using 'small' model for better accuracy, computing on CPU by default
model_size = "small"
model = WhisperModel(model_size, device="cpu", compute_type="int8")

@app.post("/")
async def speech_to_text(audio: UploadFile = File(...)):
    """
    Receives an audio file and returns the transcribed text.
    """
    # Save the uploaded file to a temporary location
    try:
        # Get original extension or default to .wav
        suffix = os.path.splitext(audio.filename)[1] if audio.filename else ".wav"
        if not suffix:
            suffix = ".wav"
            
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            content = await audio.read()
            tmp.write(content)
            tmp_path = tmp.name

        # Transcribe the audio file with Chinese language specified
        segments, info = model.transcribe(tmp_path, beam_size=5, language="zh")

        # Iterate through segments and combine the text
        transcription = []
        for segment in segments:
            transcription.append(segment.text)

        full_text = "".join(transcription).strip()

        # Clean up the temporary file
        os.unlink(tmp_path)

        return {
            "text": full_text,
            "language": info.language,
            "language_probability": info.language_probability
        }

    except Exception as e:
        if 'tmp_path' in locals() and os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise HTTPException(status_code=500, detail=f"ASR error: {str(e)}")

@app.get("/health")
async def health_check():
    return {"status": "ok", "model": model_size}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=3300)
