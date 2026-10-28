"use client";

import React, { useRef, useState, useEffect } from "react";
import { motion, useMotionValue, useTransform } from "framer-motion";

export function SlideAction({
  onAcknowledge,
  label,
  baseColor = "#F1F3F6",
  accentColor = "#C0392B",
  textColor = "#6B7684",
  resetOnComplete = true
}: {
  onAcknowledge: () => void;
  label: string;
  baseColor?: string;
  accentColor?: string;
  textColor?: string;
  resetOnComplete?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const x = useMotionValue(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      setContainerWidth(entries[0].contentRect.width);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const slideWidth = 56;
  const maxSlide = Math.max(0, containerWidth - slideWidth - 8);

  const opacity = useTransform(x, [0, maxSlide * 0.8], [1, 0]);
  const fillWidth = useTransform(x, (val) => val + slideWidth + 4);

  const handleDragEnd = () => {
    if (x.get() > maxSlide * 0.7) {
      onAcknowledge();
      if (resetOnComplete) {
        setTimeout(() => x.set(0), 300);
      }
    } else {
      x.set(0); // bounce back
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative flex h-[48px] w-full items-center overflow-hidden rounded-[12px] border border-[var(--line)] bg-white shadow-inner select-none"
      style={{ backgroundColor: baseColor }}
    >
      <motion.div
        className="absolute left-0 top-0 bottom-0 z-0 rounded-[12px]"
        style={{ width: fillWidth, backgroundColor: accentColor, opacity: 0.15 }}
      />
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
        <motion.span
          style={{ opacity, color: textColor }}
          className="text-[13px] font-extrabold uppercase tracking-[0.08em]"
        >
          {label}
        </motion.span>
      </div>
      <motion.div
        drag="x"
        dragConstraints={{ left: 0, right: maxSlide }}
        dragElastic={0.05}
        dragMomentum={false}
        onDragEnd={handleDragEnd}
        whileTap={{ cursor: "grabbing", scale: 0.95 }}
        style={{ x }}
        className="relative z-10 ml-1 flex h-[40px] w-[56px] cursor-grab items-center justify-center rounded-[10px] shadow-sm transition-shadow hover:shadow-md"
      >
        <div className="absolute inset-0 rounded-[10px]" style={{ backgroundColor: accentColor }} />
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="white"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="relative z-20"
        >
          <polyline points="13 17 18 12 13 7"></polyline>
          <polyline points="6 17 11 12 6 7"></polyline>
        </svg>
      </motion.div>
    </div>
  );
}
