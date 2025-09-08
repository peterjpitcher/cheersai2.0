import { cn } from "@/lib/utils";
import React from "react";

interface ContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  as?: keyof JSX.IntrinsicElements;
}

export default function Container({ as: Tag = 'div', className, children, ...rest }: ContainerProps) {
  return (
    <Tag className={cn("max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8", className)} {...rest}>
      {children}
    </Tag>
  );
}
