import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "default" | "secondary" | "outline" | "ghost" | "destructive";
type Size = "sm" | "md" | "icon";

const variants: Record<Variant, string> = {
  default: "bg-primary text-primary-foreground hover:bg-primary/90",
  secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
  outline: "border border-input bg-transparent hover:bg-accent",
  ghost: "hover:bg-accent",
  destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
};
const sizes: Record<Size, string> = { sm: "h-8 px-3 text-xs", md: "h-9 px-4 text-sm", icon: "h-8 w-8" };

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant = "default", size = "md", loading, disabled, children, ...props }, ref) => (
  <button
    ref={ref}
    disabled={disabled || loading}
    className={cn(
      "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
      variants[variant],
      sizes[size],
      className,
    )}
    {...props}
  >
    {loading && <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
    {children}
  </button>
));
Button.displayName = "Button";
