import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// Chunky, rounded buttons with a darker lip underneath that sinks when pressed
const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-2xl text-sm font-bold transition-[transform,box-shadow,background-color,color] duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[0_4px_0_0_hsl(var(--primary-lip))] hover:brightness-105 active:translate-y-[3px] active:shadow-[0_1px_0_0_hsl(var(--primary-lip))]",
        destructive:
          "bg-destructive text-destructive-foreground shadow-[0_4px_0_0_hsl(var(--destructive-lip))] hover:brightness-105 active:translate-y-[3px] active:shadow-[0_1px_0_0_hsl(var(--destructive-lip))]",
        outline:
          "border-2 border-border bg-card text-foreground shadow-[0_3px_0_0_hsl(var(--border))] hover:bg-accent active:translate-y-[2px] active:shadow-[0_1px_0_0_hsl(var(--border))]",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-accent active:translate-y-[1px]",
        ghost: "text-foreground hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 px-5",
        sm: "h-9 rounded-xl px-3 text-[13px]",
        lg: "h-12 px-7 text-base",
        icon: "h-11 w-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
