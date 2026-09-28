from fastapi import FastAPI, HTTPException, File, UploadFile
from pydantic import BaseModel
import cv2
import numpy as np
import base64
from rembg import remove
import pydicom
import io
import zipfile

app = FastAPI(title="DocuRay Engine")

@app.post("/process-xray")
async def process_xray(file: UploadFile = File(...)):
    try:
        # 1. Read binary image directly from the phone
        file_bytes = await file.read()
        nparr = np.frombuffer(file_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        # 2. Process image (AI Background Removal & Contrast)
        isolated_rgba = remove(img) 
        black_bg = np.zeros_like(img)
        alpha = isolated_rgba[:, :, 3]
        mask_bool = alpha > 0
        black_bg[mask_bool] = img[mask_bool]
        isolated_img = black_bg

        coords = cv2.findNonZero(alpha)
        if coords is not None:
            x, y, w, h = cv2.boundingRect(coords)
            isolated_img = isolated_img[y:y+h, x:x+w]

        clean_img = cv2.fastNlMeansDenoisingColored(isolated_img, None, 5, 5, 7, 21)
        gray = cv2.cvtColor(clean_img, cv2.COLOR_BGR2GRAY)
        mask = (gray > 0).astype(np.uint8)
        mean_brightness = cv2.mean(gray, mask=mask)[0]
        
        gamma = 2.2 if mean_brightness > 130 else (0.8 if mean_brightness < 80 else 1.2)
        inv_gamma = 1.0 / gamma
        table = np.array([((i / 255.0) ** inv_gamma) * 255 for i in np.arange(0, 256)]).astype("uint8")
        corrected = cv2.LUT(gray, table)

        std_dev = np.std(gray[mask > 0])
        if std_dev > 45:
            clahe = cv2.createCLAHE(clipLimit=3.5, tileGridSize=(8, 8))
            detailed = clahe.apply(corrected)
            gaussian = cv2.GaussianBlur(detailed, (0, 0), 3.0)
            final_scan = cv2.addWeighted(detailed, 1.5, gaussian, -0.5, 0)
        else:
            clahe = cv2.createCLAHE(clipLimit=1.5, tileGridSize=(8, 8))
            detailed = clahe.apply(corrected)
            filtered = cv2.bilateralFilter(detailed, 9, 75, 75)
            final_scan = cv2.addWeighted(detailed, 1.2, filtered, -0.2, 0)
        
        _, encoded_img = cv2.imencode('.jpg', final_scan)
        b64_string = base64.b64encode(encoded_img).decode('utf-8')
        return {"image": b64_string}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

def process_dicom_slice(ds, pixel_array):
    intercept = ds.RescaleIntercept if 'RescaleIntercept' in ds else 0.0
    slope = ds.RescaleSlope if 'RescaleSlope' in ds else 1.0
    img_data = (pixel_array * slope) + intercept

    window_center = ds.WindowCenter if 'WindowCenter' in ds else np.median(img_data)
    window_width = ds.WindowWidth if 'WindowWidth' in ds else np.ptp(img_data)

    if isinstance(window_center, pydicom.multival.MultiValue): window_center = window_center[0]
    if isinstance(window_width, pydicom.multival.MultiValue): window_width = window_width[0]

    min_value = window_center - (window_width / 2.0)
    max_value = window_center + (window_width / 2.0)
    
    img_2d = np.clip(img_data, min_value, max_value)
    img_2d = cv2.normalize(img_2d, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
    
    if img_2d.ndim == 3 and img_2d.shape[-1] == 3:
        img_2d = cv2.cvtColor(img_2d, cv2.COLOR_RGB2GRAY)

    _, encoded_img = cv2.imencode('.jpg', img_2d)
    return base64.b64encode(encoded_img).decode('utf-8')

@app.post("/process-dicom")
async def process_dicom(file: UploadFile = File(...)):
    try:
        print(f"\n📂 Received File: {file.filename}")
        file_bytes = await file.read() 
        frames = []

        try:
            with zipfile.ZipFile(io.BytesIO(file_bytes)) as z:
                print("📦 ZIP file detected! Extracting slices...")
                dicom_files = [f for f in z.namelist() if not f.startswith('__MACOSX') and not f.endswith('/')]
                datasets = []
                
                for f in dicom_files:
                    try:
                        ds = pydicom.dcmread(io.BytesIO(z.read(f)))
                        if hasattr(ds, 'PixelData'):
                            datasets.append(ds)
                        else:
                            print(f"⏭️ Skipping non-image metadata file: {f}")
                    except:
                        pass
                
                if len(datasets) == 0:
                    raise ValueError("No valid image slices found in the ZIP.")

                datasets.sort(key=lambda x: getattr(x, 'InstanceNumber', 0))
                
                for ds in datasets:
                    pixel_array = ds.pixel_array
                    if pixel_array.ndim == 3 and pixel_array.shape[-1] != 3:
                        for i in range(pixel_array.shape[0]):
                            frames.append(process_dicom_slice(ds, pixel_array[i]))
                    else:
                        frames.append(process_dicom_slice(ds, pixel_array))
                    
        except zipfile.BadZipFile:
            print("📄 Single DICOM file detected.")
            ds = pydicom.dcmread(io.BytesIO(file_bytes))
            
            if not hasattr(ds, 'PixelData'):
                raise ValueError("This DICOM file does not contain an image.")
                
            pixel_array = ds.pixel_array
            
            if pixel_array.ndim == 3 and pixel_array.shape[-1] != 3:
                for i in range(pixel_array.shape[0]):
                    frames.append(process_dicom_slice(ds, pixel_array[i]))
            else:
                frames.append(process_dicom_slice(ds, pixel_array))

        print(f"✅ Extracted {len(frames)} frames successfully!")
        return {"frames": frames}
        
    except Exception as e:
        print(f"❌ DICOM Error: {e}")
        raise HTTPException(status_code=400, detail=str(e))