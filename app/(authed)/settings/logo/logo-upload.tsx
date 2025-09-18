'use client'

import { useState, useRef } from 'react'
import { Upload, Loader2 } from 'lucide-react'
import { uploadLogo } from './actions'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

interface LogoUploadProps {
  tenantId: string
}

export function LogoUpload({ tenantId }: LogoUploadProps) {
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  
  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    
    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file')
      return
    }
    
    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File size must be less than 5MB')
      return
    }
    
    setUploading(true)
    
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('tenant_id', tenantId)
      
      const result = await uploadLogo(formData)
      
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Logo uploaded successfully')
        router.refresh()
      }
    } catch (error) {
      toast.error('Failed to upload logo')
    } finally {
      setUploading(false)
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }
  
  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        id="logo-upload"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
        disabled={uploading}
      />
      <Button onClick={() => fileInputRef.current?.click()} loading={uploading} className="inline-flex items-center">
        {!uploading && (
          <>
            <Upload className="mr-2 size-4" />
            Upload Logo
          </>
        )}
      </Button>
      <p className="mt-2 text-xs text-text-secondary">
        Supported formats: PNG, JPG, GIF, SVG (max 5MB)
      </p>
    </div>
  )
}
