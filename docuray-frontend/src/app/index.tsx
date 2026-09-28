import { useState, useRef, useEffect } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';

export default function App() {
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState('camera'); 
  
  const [frames, setFrames] = useState([]);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLooping, setIsLooping] = useState(true);
  const [loading, setLoading] = useState(false);
  
  const cameraRef = useRef(null);
  const scrubRef = useRef(null); 

  useEffect(() => {
    let interval;
    if (isPlaying && frames.length > 1) {
      interval = setInterval(() => {
        setCurrentFrame((prev) => {
          if (prev === frames.length - 1) {
            if (isLooping) return 0; 
            else {
              setIsPlaying(false); 
              return prev; 
            }
          }
          return prev + 1; 
        });
      }, 100); 
    }
    return () => clearInterval(interval);
  }, [isPlaying, frames, isLooping]);

  const startScrubbing = (direction) => {
    setIsPlaying(false);
    if (scrubRef.current) clearInterval(scrubRef.current);
    scrubRef.current = setInterval(() => {
      setCurrentFrame((prev) => {
        if (direction === 'next') return (prev + 1) % frames.length;
        return prev > 0 ? prev - 1 : frames.length - 1;
      });
    }, 60); 
  };

  const stopScrubbing = () => {
    if (scrubRef.current) {
      clearInterval(scrubRef.current);
      scrubRef.current = null;
    }
  };

  const stepFrame = (direction) => {
    setIsPlaying(false);
    setCurrentFrame((prev) => {
      if (direction === 'next') return (prev + 1) % frames.length;
      return prev > 0 ? prev - 1 : frames.length - 1;
    });
  };

  if (!permission) return <View />;
  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>DocuRay needs camera access.</Text>
        <TouchableOpacity onPress={requestPermission} style={styles.btn}><Text style={styles.btnTextDark}>Grant</Text></TouchableOpacity>
      </View>
    );
  }

  const processImageToBackend = async (imageUri) => {
    setLoading(true);
    try {
      const serverResponse = await FileSystem.uploadAsync(
        'http://192.168.29.104:8000/process-xray',
        imageUri,
        {
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
          fieldName: 'file',
          mimeType: 'image/jpeg',
        }
      );
      
      if (serverResponse.status === 200) {
        const data = JSON.parse(serverResponse.body);
        setFrames([`data:image/jpeg;base64,${data.image}`]);
        setCurrentFrame(0);
      } else {
        alert("Backend Error: " + serverResponse.body);
      }
    } catch (error) { 
      alert("Network Error: Make sure your Python server is running and the IP address is correct."); 
    }
    setLoading(false);
  };

  const takePicture = async () => {
    if (cameraRef.current) {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
      await processImageToBackend(photo.uri);
    }
  };

  const pickImageFromGallery = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0].uri) {
      await processImageToBackend(result.assets[0].uri);
    }
  };

  const pickAndProcessDicom = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: false });
      if (result.canceled || !result.assets || result.assets.length === 0) return;
      
      setLoading(true);
      const fileAsset = result.assets[0];
      const safeUri = FileSystem.documentDirectory + "upload_ready.zip";
      await FileSystem.copyAsync({ from: fileAsset.uri, to: safeUri });

      const serverResponse = await FileSystem.uploadAsync(
        'http://192.168.29.104:8000/process-dicom',
        safeUri,
        {
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
          fieldName: 'file', 
          mimeType: 'application/zip', 
        }
      );
      
      if (serverResponse.status === 200) {
        const data = JSON.parse(serverResponse.body);
        if (data.frames && data.frames.length > 0) {
          const formattedFrames = data.frames.map(f => `data:image/jpeg;base64,${f}`);
          setFrames(formattedFrames);
          setCurrentFrame(0);
          if (formattedFrames.length > 1) setIsPlaying(true);
        } else alert("No frames found.");
      } else alert("Backend Error: " + serverResponse.body);
    } catch (error) { alert("Error uploading file."); }
    setLoading(false);
  };

  const exportCurrentFrame = async () => {
    try {
      const base64Code = frames[currentFrame].split(',')[1];
      const filename = FileSystem.documentDirectory + `DocuRay_Slice_${currentFrame}.jpg`;
      await FileSystem.writeAsStringAsync(filename, base64Code, { encoding: FileSystem.EncodingType.Base64 });
      await Sharing.shareAsync(filename);
    } catch (error) { alert("Error saving Image"); }
  };

  if (frames.length > 0) {
    return (
      <View style={styles.container}>
        <View style={styles.viewerContainer}>
            <Image source={{ uri: frames[currentFrame] }} style={styles.previewImage} resizeMode="contain" fadeDuration={0} />
            {frames.length > 1 && (
                <View style={styles.sliceCounter}>
                    <Text style={styles.sliceText}>Slice {currentFrame + 1} / {frames.length}</Text>
                </View>
            )}
        </View>
        
        <View style={styles.controlPanel}>
          {frames.length > 1 && (
              <View>
                <TouchableOpacity 
                    style={[styles.loopBtn, { backgroundColor: isLooping ? '#fff' : '#333' }]} 
                    onPress={() => setIsLooping(!isLooping)}
                >
                    <Text style={[styles.btnTextDark, { color: isLooping ? '#000' : '#fff' }]}>
                        {isLooping ? 'Continuous Loop: ON' : 'Continuous Loop: OFF'}
                    </Text>
                </TouchableOpacity>

                <View style={styles.cineControls}>
                    <TouchableOpacity style={styles.smallBtn} onPress={() => stepFrame('prev')} onLongPress={() => startScrubbing('prev')} onPressOut={stopScrubbing} delayLongPress={800}>
                        <Text style={styles.btnTextLight}>{'< Prev'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.smallBtn, {backgroundColor: isPlaying ? '#333' : '#fff'}]} onPress={() => setIsPlaying(!isPlaying)}>
                        <Text style={isPlaying ? styles.btnTextLight : styles.btnTextDark}>{isPlaying ? 'Stop Video' : 'Play Video'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.smallBtn} onPress={() => stepFrame('next')} onLongPress={() => startScrubbing('next')} onPressOut={stopScrubbing} delayLongPress={800}>
                        <Text style={styles.btnTextLight}>{'Next >'}</Text>
                    </TouchableOpacity>
                </View>
              </View>
          )}

          <TouchableOpacity style={[styles.btn, { backgroundColor: '#555' }]} onPress={exportCurrentFrame}>
            <Text style={styles.btnTextLight}>Export Frame as JPEG</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btn} onPress={() => { setFrames([]); setIsPlaying(false); }}>
            <Text style={styles.btnTextDark}>Process Another Scan</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.tabContainer}>
        <TouchableOpacity style={[styles.tab, mode === 'camera' && styles.activeTab]} onPress={() => setMode('camera')}>
          <Text style={[styles.tabText, mode === 'camera' && styles.activeTabText]}>Camera Scanner</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, mode === 'dicom' && styles.activeTab]} onPress={() => setMode('dicom')}>
          <Text style={[styles.tabText, mode === 'dicom' && styles.activeTabText]}>DICOM Loop</Text>
        </TouchableOpacity>
      </View>

      {mode === 'camera' ? (
        <CameraView style={styles.camera} ref={cameraRef} exposure={-1}>
          <View style={styles.overlay}>
            <View style={styles.scanFrame} />
            <Text style={styles.instruction}>Align X-Ray within the frame</Text>
          </View>
          <View style={styles.buttonContainer}>
            {loading ? <ActivityIndicator size="large" color="#fff" /> : (
              <View style={styles.cameraActionRow}>
                <TouchableOpacity style={styles.galleryBtn} onPress={pickImageFromGallery}>
                  <Text style={styles.galleryBtnText}>Gallery</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.captureBtn} onPress={takePicture}>
                  <View style={styles.captureBtnInner} />
                </TouchableOpacity>
                <View style={{ width: 60 }} />
              </View>
            )}
          </View>
        </CameraView>
      ) : (
        <View style={styles.dicomContainer}>
          <Text style={styles.instruction}>Upload a .ZIP of DICOM Slices</Text>
          {loading ? (
             <ActivityIndicator size="large" color="#fff" style={{marginTop: 30}} />
          ) : (
            <TouchableOpacity style={[styles.btn, {marginTop: 30}]} onPress={pickAndProcessDicom}>
              <Text style={styles.btnTextDark}>Upload & Play Loop</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  text: { color: 'white', textAlign: 'center', marginBottom: 20 },
  tabContainer: { flexDirection: 'row', paddingTop: 50, backgroundColor: '#111' },
  tab: { flex: 1, padding: 15, alignItems: 'center', borderBottomWidth: 2, borderColor: '#111' },
  activeTab: { borderColor: '#fff' },
  tabText: { color: '#666', fontWeight: 'bold' },
  activeTabText: { color: '#fff' },
  dicomContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  camera: { flex: 1 },
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)' },
  scanFrame: { width: 300, height: 400, borderWidth: 2, borderColor: '#fff', backgroundColor: 'transparent' },
  instruction: { color: '#fff', marginTop: 20, fontSize: 16, fontWeight: 'bold' },
  buttonContainer: { paddingBottom: 40, paddingTop: 20, backgroundColor: '#000' },
  cameraActionRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', width: '100%' },
  captureBtn: { width: 70, height: 70, borderRadius: 35, backgroundColor: '#333', justifyContent: 'center', alignItems: 'center' },
  captureBtnInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#fff' },
  galleryBtn: { width: 60, height: 60, borderRadius: 10, backgroundColor: '#222', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#555' },
  galleryBtnText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  viewerContainer: { flex: 1, position: 'relative' },
  previewImage: { flex: 1, width: '100%', marginTop: 20 },
  sliceCounter: { position: 'absolute', top: 30, right: 20, backgroundColor: 'rgba(255,255,255,0.9)', padding: 8, borderRadius: 5 },
  sliceText: { color: '#000', fontWeight: 'bold' },
  controlPanel: { backgroundColor: '#111', padding: 20, borderTopWidth: 1, borderColor: '#222' },
  cineControls: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15 },
  loopBtn: { padding: 8, borderRadius: 8, alignSelf: 'center', marginBottom: 15, paddingHorizontal: 20 },
  smallBtn: { backgroundColor: '#222', padding: 12, borderRadius: 8, flex: 1, marginHorizontal: 5, alignItems: 'center', borderWidth: 1, borderColor: '#444' },
  btn: { backgroundColor: '#fff', padding: 15, borderRadius: 10, alignSelf: 'center', marginVertical: 5, width: '90%', alignItems: 'center' },
  btnTextDark: { color: '#000', fontWeight: 'bold', fontSize: 16 },
  btnTextLight: { color: '#fff', fontWeight: 'bold', fontSize: 16 }
});