import { Input as BaseInput } from "@base-ui/react/input";
import type { ComponentProps } from "react";

export type InputProps = Omit<ComponentProps<typeof BaseInput>, "className"> & {
  controlSize?: "sm" | "md";
  textSize?: "default" | "large";
};
export function Input({
  controlSize = "md",
  textSize = "default",
  ...props
}: InputProps) {
  return (
    <BaseInput
      {...props}
      data-buzz-ui=""
      data-size={controlSize}
      data-text-size={textSize}
      className="buzz-input"
    />
  );
}
