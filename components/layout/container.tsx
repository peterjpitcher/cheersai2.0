import { cn } from "@/lib/utils";
import React from "react";

interface ContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  as?: React.ElementType;
}

export default function Container({ as: Tag = 'div', className, children, ...rest }: ContainerProps) {
  return (
    <Tag
      className={cn(
        // Consistent horizontal padding across the app
        "max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8",
        // Encourage vertical rhythm via utility class when needed
        className
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}
