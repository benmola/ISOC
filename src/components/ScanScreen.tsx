import React, { useRef, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, ScanLine, Camera, Image as ImageIcon, Loader2, Users, Trash2, X, FileText } from 'lucide-react';
import { cn } from '../lib/utils';
import { parseTimetable } from '../services/timetableParser';
import { db, auth } from '../firebase';
import { doc, setDoc, collection, getDocs, getDoc, query, orderBy, limit, deleteDoc } from 'firebase/firestore';

export const ScanScreen: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState<string | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [jumuahLocation, setJumuahLocation] = useState('university-hall');
  const [isUpdatingJumuah, setIsUpdatingJumuah] = useState(false);
  const [viewHistoryUrl, setViewHistoryUrl] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch History
        const q = query(collection(db, 'schedules'), orderBy('uploadedAt', 'desc'), limit(5));
        const querySnapshot = await getDocs(q);
        const docs = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setHistory(docs);

        // Fetch Jumu'ah
        const snap = await getDoc(doc(db, 'configs', 'jumuah'));
        if (snap.exists()) setJumuahLocation(snap.data().locationId);
      } catch (error) {
        console.error("Error fetching data:", error);
      }
    };
    fetchData();
  }, [scanStatus]);

  const handleUpdateJumuah = async (locationId: string) => {
    // For now, allow any user to set the location (Public)
    setJumuahLocation(locationId); 
    setIsUpdatingJumuah(true);
    try {
      await setDoc(doc(db, 'configs', 'jumuah'), {
        locationId,
        updatedAt: new Date().toISOString(),
        updatedBy: auth.currentUser?.uid || 'anonymous'
      });
    } catch (error) {
      console.error("Error updating Jumu'ah:", error);
      alert("Error: Could not update location. Check your internet.");
    } finally {
      setIsUpdatingJumuah(false);
    }
  };

  const handleDeleteHistory = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm("Are you sure you want to absolutely delete this scheduled month?")) return;
    try {
      await deleteDoc(doc(db, 'schedules', id));
      setHistory(prev => prev.filter(item => item.id !== id));
    } catch (error) {
      console.error(error);
      alert("Failed to delete schedule from database.");
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setPreviewUrl(file.type.startsWith('image/') ? URL.createObjectURL(file) : null);
    }
  };

  const triggerUpload = () => fileInputRef.current?.click();
  const triggerCamera = () => cameraInputRef.current?.click();

  const compressImage = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new window.Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 1200;
          const MAX_HEIGHT = 1600;
          let width = img.width;
          let height = img.height;
          if (width > height) { if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; } }
          else { if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; } }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) { ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, width, height); ctx.drawImage(img, 0, 0, width, height); }
          resolve(canvas.toDataURL('image/jpeg', 0.6));
        };
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = event.target?.result as string;
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });

  const handleScan = async () => {
    if (!selectedFile || !auth.currentUser) {
      setScanStatus("Please select a file first");
      return;
    }

    setIsScanning(true);
    setScanStatus("Reading file...");

    try {
      const parsedData = await parseTimetable(selectedFile, (msg) => setScanStatus(msg));

      if (parsedData && parsedData.length > 0) {
        setScanStatus("Saving to database...");

        const firstDate = new Date(parsedData[0].dateStr);
        if (isNaN(firstDate.getTime())) {
          throw new Error("Invalid date extracted: " + parsedData[0].dateStr);
        }

        const monthId = `${firstDate.getFullYear()}-${String(firstDate.getMonth() + 1).padStart(2, '0')}`;
        const monthName = firstDate.toLocaleString('default', { month: 'long', year: 'numeric' });

        // Compress image for Firestore storage (only for image uploads)
        let imageUrl: string | null = null;
        if (selectedFile.type.startsWith('image/')) {
          imageUrl = await compressImage(selectedFile);
        }

        await setDoc(doc(db, 'schedules', monthId), {
          month: monthName,
          uploadedBy: auth.currentUser.uid,
          uploadedAt: new Date().toISOString(),
          imageUrl,
          days: parsedData
        });

        setScanStatus(`Success! Extracted ${parsedData.length} days for ${monthName}.`);
        setTimeout(() => {
          setSelectedFile(null);
          setPreviewUrl(null);
          setScanStatus(null);
        }, 3000);
      } else {
        throw new Error("No data extracted from file");
      }
    } catch (error) {
      console.error("Parse error:", error);
      const message = error instanceof Error ? error.message : "Failed to parse file. Please try again.";
      setScanStatus(message);
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <div className="space-y-8 animate-in slide-in-from-right-4 duration-500">
      <section className="text-center">
        <h2 className="font-headline text-3xl font-extrabold text-primary mb-3 tracking-tight">Upload Timetable</h2>
        <p className="text-on-surface-variant leading-relaxed max-w-md mx-auto text-sm">
          Upload your prayer room's printed schedule as an image or PDF. The app will extract and sync the Athan and Iqama times for all users.
        </p>
      </section>

      {/* Upload Area */}
      <div className="space-y-6">
        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          accept="image/*,.pdf,application/pdf"
          onChange={handleFileChange}
        />
        <input 
          type="file" 
          ref={cameraInputRef} 
          className="hidden" 
          accept="image/*" 
          capture="environment" 
          onChange={handleFileChange} 
        />

        <div className="grid grid-cols-2 gap-4">
          <button 
            onClick={triggerUpload}
            className="bg-surface-container-lowest rounded-2xl p-6 flex flex-col items-center justify-center border-2 border-dashed border-outline-variant hover:border-primary/40 transition-all group cursor-pointer active:scale-95 shadow-sm"
          >
            <div className="w-12 h-12 rounded-full bg-secondary-container flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
              <ImageIcon className="w-6 h-6 text-primary" />
            </div>
            <h3 className="font-headline font-bold text-sm text-on-surface">Upload File</h3>
            <p className="text-[9px] text-on-surface-variant mt-1">Image or PDF</p>
          </button>

          <button 
            onClick={triggerCamera}
            className="bg-surface-container-lowest rounded-2xl p-6 flex flex-col items-center justify-center border-2 border-dashed border-outline-variant hover:border-primary/40 transition-all group cursor-pointer active:scale-95 shadow-sm"
          >
            <div className="w-12 h-12 rounded-full bg-tertiary-container flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
              <Camera className="w-6 h-6 text-tertiary" />
            </div>
            <h3 className="font-headline font-bold text-sm text-on-surface">Take Picture</h3>
            <p className="text-[9px] text-on-surface-variant mt-1">Camera</p>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Preview */}
          <div className="bg-surface-container rounded-xl overflow-hidden aspect-[3/4] relative group border border-outline-variant/10 shadow-inner">
            {previewUrl ? (
              <img
                alt="Preview"
                className="w-full h-full object-contain"
                src={previewUrl}
                referrerPolicy="no-referrer"
              />
            ) : selectedFile ? (
              <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center">
                <FileText className="w-16 h-16 mb-4 text-primary" />
                <p className="text-sm font-bold text-on-surface">{selectedFile.name}</p>
                <p className="text-[10px] text-on-surface-variant mt-1">PDF Document</p>
              </div>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center opacity-40">
                <ScanLine className="w-12 h-12 mb-4" />
                <p className="text-xs font-medium">No file selected</p>
              </div>
            )}
            <div className="absolute inset-0 flex items-center justify-center bg-on-surface/5 opacity-0 group-hover:opacity-100 transition-opacity">
              <span className="bg-surface-container-lowest/90 px-4 py-2 rounded-full text-[10px] font-bold text-primary shadow-sm uppercase tracking-widest">
                {selectedFile ? 'Ready to Parse' : 'Waiting for Upload'}
              </span>
            </div>
          </div>

          {/* Smart Parsing Info */}
          <div className="bg-surface-container-low rounded-xl p-6 flex flex-col justify-between border border-outline-variant/5">
            <div>
              <div className="flex items-center gap-2 mb-4 text-tertiary">
                <Sparkles className="w-4 h-4" />
                <span className="font-bold text-[10px] tracking-wide uppercase">Text Extraction</span>
              </div>
              <p className="text-xs text-on-surface-variant leading-relaxed mb-6">
                For best results, upload a PDF with selectable text. Images work too — ensure they are well-lit and clearly legible.
              </p>
              <ul className="space-y-3">
                {[
                  "Prayer Names (Fajr, Dhuhr...)",
                  "Athan & Iqama Times",
                  "Monthly Date Columns"
                ].map((item, idx) => (
                  <li key={idx} className="flex items-center gap-3 text-[11px] font-medium text-on-secondary-container">
                    <span className="w-5 h-5 rounded-full bg-secondary-container flex items-center justify-center text-[10px] font-bold">{idx + 1}</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <button 
              disabled={!selectedFile || isScanning}
              onClick={handleScan}
              className={cn(
                "w-full py-4 font-bold rounded-full flex items-center justify-center gap-2 shadow-sm transition-all active:scale-95 mt-4",
                selectedFile && !isScanning ? "bg-primary text-on-primary hover:shadow-md" : "bg-surface-container-high text-on-surface-variant/40 cursor-not-allowed"
              )}
            >
              {isScanning ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  {scanStatus || "Processing..."}
                </>
              ) : (
                <>
                  <ScanLine className="w-5 h-5" />
                  Extract Schedule
                </>
              )}
            </button>
            {scanStatus && !isScanning && (
              <p className="text-center text-xs mt-2 font-medium text-primary">{scanStatus}</p>
            )}
          </div>
        </div>
      </div>

      {/* Jumu'ah Admin */}
      <section className="mt-8 bg-surface-container-lowest p-6 rounded-2xl border border-outline-variant/10 shadow-sm">
        <h3 className="font-headline font-bold text-xl text-primary mb-4 flex items-center gap-2">
          <Users className="w-5 h-5" />
          Set Next Jumu'ah
        </h3>
        <p className="text-xs text-on-surface-variant mb-4 font-medium leading-relaxed">
          Select where the next Friday prayer will be held. This updates for all users.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {['university-hall', 'rubix'].map((locId) => (
            <button
              key={locId}
              disabled={isUpdatingJumuah}
              onClick={() => handleUpdateJumuah(locId)}
              className={cn(
                "py-3 px-4 rounded-xl font-bold text-[11px] transition-all border-2 uppercase tracking-widest",
                jumuahLocation === locId 
                  ? "bg-primary text-on-primary border-primary shadow-md" 
                  : "bg-surface-container-low text-on-surface-variant border-outline-variant/10 hover:border-primary/20"
              )}
            >
              {locId === 'university-hall' ? 'University Hall' : 'Rubix'}
            </button>
          ))}
        </div>
      </section>

      {/* History */}
      <section className="mt-8 bg-surface-container-lowest p-6 rounded-2xl border border-outline-variant/10 shadow-sm">
        <h3 className="font-headline font-bold text-xl text-primary mb-4 flex items-center gap-2">
          <ScanLine className="w-5 h-5" />
          Update History
        </h3>
        <div className="space-y-3">
          {history.length > 0 ? (
            history.map((item) => (
              <div key={item.id} className="flex items-center justify-between p-3 rounded-xl bg-surface-container-low border border-outline-variant/5">
                <div>
                  <h4 className="font-bold text-sm text-on-surface">{item.month}</h4>
                  <p className="text-[10px] text-on-surface-variant">
                    Updated {new Date(item.uploadedAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {item.imageUrl && (
                    <button 
                      onClick={() => setViewHistoryUrl(item.imageUrl)}
                      className="p-2 hover:bg-secondary-container rounded-full text-secondary transition-colors"
                      title="View Image"
                    >
                      <ImageIcon className="w-4 h-4" />
                    </button>
                  )}
                  <button 
                    onClick={(e) => handleDeleteHistory(item.id, e)}
                    className="p-2 hover:bg-error/10 rounded-full text-error transition-colors"
                    title="Delete Schedule"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <div className="bg-primary/10 px-2 py-1 rounded text-[9px] font-bold text-primary uppercase ml-1">
                    Active
                  </div>
                </div>
              </div>
            ))
          ) : (
            <p className="text-xs text-on-surface-variant italic py-2">
              No recent updates found.
            </p>
          )}
        </div>
      </section>

      {/* History Image Modal */}
      <AnimatePresence>
        {viewHistoryUrl && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/90 flex flex-col items-center justify-center p-4 backdrop-blur-sm"
          >
            <div className="w-full max-w-2xl flex justify-end mb-4">
              <button 
                onClick={() => setViewHistoryUrl(null)}
                className="p-3 bg-white/10 rounded-full text-white hover:bg-white/20 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="relative w-full max-w-2xl max-h-[80vh] overflow-hidden rounded-2xl flex items-center justify-center">
              <img 
                src={viewHistoryUrl} 
                alt="History Timetable" 
                className="max-w-full max-h-[80vh] object-contain rounded-lg shadow-2xl"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
