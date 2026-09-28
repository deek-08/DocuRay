# DocuRay: Clinical-Grade Mobile DICOM & X-Ray Suite

DocuRay is a dual-mode native mobile application designed to bridge the gap between heavy hospital radiology software and mobile accessibility. It digitizes physical X-rays via an AI-enhanced camera scanner and natively renders complex MRI/CT `.zip` archives into seamless 10FPS Cine Loops directly on a smartphone.

# Key Engineering Features
- Native Memory Bypass: Bypasses Android's strict scoped storage and React Native's Base64 memory limits by utilizing native `FileSystem.uploadAsync` for direct binary transmission of heavy `.zip` archives.
- AI Background Isolation: Utilizes `rembg` neural networks to instantly isolate physical X-ray films from complex real-world backgrounds.
- Clinical DICOM Windowing: Implements professional-grade CLAHE algorithms and OpenCV logic to process raw `.dcm` metadata (WindowCenter/WindowWidth), applying precise contrast enhancements rather than generic image flattening.
- Zero-Flicker Cine Loop Engine: A custom React Native video player capable of rendering 10FPS interactive multi-planar reconstruction (MPR) loops with frame-by-frame extraction and press-and-hold scrubbing.

# Tech Stack
- Frontend: React Native, Expo, Expo Camera, Expo FileSystem
- Backend: Python, FastAPI, OpenCV, Pydicom, NumPy
