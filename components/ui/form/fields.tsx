import * as React from 'react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

interface BaseProps {
  id: string;
  label: string;
  description?: string;
  error?: string;
  className?: string;
}

export function FormText({ id, label, description, error, className, ...props }: BaseProps & React.ComponentProps<typeof Input>) {
  const describedBy = [description && `${id}-desc`, error && `${id}-err`].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('grid gap-1', className)}>
      <label htmlFor={id} className="label">{label}</label>
      <Input id={id} aria-invalid={!!error} aria-describedby={describedBy} {...props} />
      {description && <p id={`${id}-desc`} className="text-xs text-text-secondary">{description}</p>}
      {error && <p id={`${id}-err`} className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function FormTextarea({ id, label, description, error, className, ...props }: BaseProps & React.ComponentProps<typeof Textarea>) {
  const describedBy = [description && `${id}-desc`, error && `${id}-err`].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('grid gap-1', className)}>
      <label htmlFor={id} className="label">{label}</label>
      <Textarea id={id} aria-invalid={!!error} aria-describedby={describedBy} {...props} />
      {description && <p id={`${id}-desc`} className="text-xs text-text-secondary">{description}</p>}
      {error && <p id={`${id}-err`} className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function FormSelect({ id, label, description, error, className, children, ...props }: BaseProps & React.ComponentProps<'select'>) {
  const describedBy = [description && `${id}-desc`, error && `${id}-err`].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('grid gap-1', className)}>
      <label htmlFor={id} className="label">{label}</label>
      <Select id={id} aria-invalid={!!error} aria-describedby={describedBy} {...(props as any)}>
        {children}
      </Select>
      {description && <p id={`${id}-desc`} className="text-xs text-text-secondary">{description}</p>}
      {error && <p id={`${id}-err`} className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function FormSwitch({ id, label, description, error, className, ...props }: BaseProps & React.ComponentProps<typeof Switch>) {
  const describedBy = [description && `${id}-desc`, error && `${id}-err`].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('grid gap-1', className)}>
      <div className="flex items-center gap-3">
        <Switch id={id} aria-describedby={describedBy} {...props} />
        <label htmlFor={id} className="text-sm font-medium">{label}</label>
      </div>
      {description && <p id={`${id}-desc`} className="text-xs text-text-secondary">{description}</p>}
      {error && <p id={`${id}-err`} className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function FormDateTime({ id, label, description, error, className, ...props }: BaseProps & React.InputHTMLAttributes<HTMLInputElement>) {
  const describedBy = [description && `${id}-desc`, error && `${id}-err`].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('grid gap-1', className)}>
      <label htmlFor={id} className="label">{label}</label>
      <Input id={id} type="datetime-local" aria-invalid={!!error} aria-describedby={describedBy} {...props} />
      {description && <p id={`${id}-desc`} className="text-xs text-text-secondary">{description}</p>}
      {error && <p id={`${id}-err`} className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
