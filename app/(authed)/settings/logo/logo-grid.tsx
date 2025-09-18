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
      <div className="rounded-medium bg-gray-50 py-8 text-center">
        <Image className="mx-auto mb-3 size-12 text-text-secondary/30" />
        <p className="text-text-secondary">No logos uploaded yet</p>
        <p className="mt-1 text-sm text-text-secondary">
          Upload your first logo to get started
        </p>
      </div>
    )
  }
  
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
      {logos.map((logo) => (
        <div
          key={logo.id}
          className="group relative rounded-medium border border-border bg-white p-4 transition-shadow hover:shadow-md"
        >
          <div className="relative mb-3 aspect-square rounded-soft bg-gray-100 p-2">
            <img
              src={logo.file_url}
              alt={logo.file_name || undefined}
              className="size-full object-contain"
            />
            {logo.is_active && (
              <div className="absolute right-2 top-2 rounded-full bg-success p-1 text-white">
                <Check className="size-3" />
              </div>
            )}
          </div>
          
          <p className="mb-2 truncate text-center text-xs" title={logo.file_name || undefined}>
            {logo.file_name || ''}
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
              disabled={!!logo.is_active}
              variant="destructive"
              size="sm"
              className="flex-1"
              title={logo.is_active ? 'Cannot delete active logo' : 'Delete logo'}
            >
              {!deleting && <Trash2 className="mr-1 inline size-3" />}
              Delete
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}
