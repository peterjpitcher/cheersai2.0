'use client'

import { useState } from 'react'
import { Trash2, Check, Image } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { deleteLogo, setActiveLogo } from './actions'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import type { Database } from '@/lib/types/database'

type Logo = Database['public']['Tables']['tenant_logos']['Row']

interface LogoGridProps {
  logos: Logo[]
}

export function LogoGrid({ logos }: LogoGridProps) {
  const [deleting, setDeleting] = useState<string | null>(null)
  const [settingActive, setSettingActive] = useState<string | null>(null)
  const router = useRouter()
  
  async function handleDelete(logoId: string) {
    if (!confirm('Are you sure you want to delete this logo?')) return
    
    setDeleting(logoId)
    
    try {
      const result = await deleteLogo(logoId)
      
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Logo deleted successfully')
        router.refresh()
      }
    } catch (error) {
      toast.error('Failed to delete logo')
    } finally {
      setDeleting(null)
    }
  }
  
  async function handleSetActive(logoId: string) {
    setSettingActive(logoId)
    
    try {
      const result = await setActiveLogo(logoId)
      
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Active logo updated')
        router.refresh()
      }
    } catch (error) {
      toast.error('Failed to set active logo')
    } finally {
      setSettingActive(null)
    }
  }
  
  if (logos.length === 0) {
    return (
      <div className="text-center py-8 bg-gray-50 rounded-medium">
        <Image className="w-12 h-12 text-text-secondary/30 mx-auto mb-3" />
        <p className="text-text-secondary">No logos uploaded yet</p>
        <p className="text-sm text-text-secondary mt-1">
          Upload your first logo to get started
        </p>
      </div>
    )
  }
  
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {logos.map((logo) => (
        <div
          key={logo.id}
          className="relative group border border-border rounded-medium p-4 hover:shadow-md transition-shadow bg-white"
        >
          <div className="aspect-square bg-gray-100 rounded-soft mb-3 p-2 relative">
            <img
              src={logo.file_url}
              alt={logo.file_name}
              className="w-full h-full object-contain"
            />
            {logo.is_active && (
              <div className="absolute top-2 right-2 bg-success text-white p-1 rounded-full">
                <Check className="w-3 h-3" />
              </div>
            )}
          </div>
          
          <p className="text-xs text-center truncate mb-2" title={logo.file_name}>
            {logo.file_name}
          </p>
          
          <div className="flex gap-2">
            {!logo.is_active && (
              <Button
                onClick={() => handleSetActive(logo.id)}
                loading={settingActive === logo.id}
                variant="secondary"
                size="sm"
                className="flex-1"
              >
                Set Active
              </Button>
            )}
            
            <Button
              onClick={() => handleDelete(logo.id)}
              loading={deleting === logo.id}
              disabled={logo.is_active}
              variant="destructive"
              size="sm"
              className="flex-1"
              title={logo.is_active ? 'Cannot delete active logo' : 'Delete logo'}
            >
              {!deleting && <Trash2 className="w-3 h-3 inline mr-1" />}
              Delete
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}
