export async function compressImage(
  file: File,
  maxWidth: number = 1920,
  maxHeight: number = 1080,
  quality: number = 0.8
): Promise<File> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      const img = new Image();
      
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;
        
        // Calculate new dimensions while maintaining aspect ratio
        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Failed to get canvas context"));
          return;
        }
        
        // Use better image smoothing
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        
        // Draw the image
        ctx.drawImage(img, 0, 0, width, height);
        
        // Determine output format - convert HEIC/HEIF to JPEG for better compatibility
        const isHEIC = file.type.includes("heic") || file.type.includes("heif") || 
                       file.name.match(/\.(heic|heif)$/i);
        const outputType = isHEIC ? "image/jpeg" : file.type;
        
        // Update filename if converting HEIC/HEIF to JPEG
        let outputName = file.name;
        if (isHEIC) {
          outputName = file.name.replace(/\.(heic|heif)$/i, '.jpg');
        }
        
        // Convert to blob
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error("Failed to compress image"));
              return;
            }
            
            // Create new file from blob
            const compressedFile = new File([blob], outputName, {
              type: outputType,
              lastModified: Date.now(),
            });
            
            // For HEIC/HEIF files, always use the converted version
            // For other formats, only use compressed version if it's actually smaller
            if (isHEIC || compressedFile.size < file.size) {
              resolve(compressedFile);
            } else {
              resolve(file);
            }
          },
          outputType,
          quality
        );
      };
      
      img.onerror = () => reject(new Error("Failed to load image. This may be due to an unsupported format or corrupted file."));
      img.src = e.target?.result as string;
    };
    
    reader.onerror = () => reject(new Error("Failed to read file. Please check the file is not corrupted."));
    reader.readAsDataURL(file);
  });
}