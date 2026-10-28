"use client";

import React, { useState, useRef, useEffect } from "react";
import { motion, useAnimation, useMotionValue, useTransform } from "framer-motion";

interface SlideButtonProps {
  onSuccess: () => void;
  text?: string;
  successText?: string;
}

export default function SlideButton({ onSuccess, text = "Slide to Confirm", successText = "Confirmed!" }: SlideButtonProps) {
  const [isSuccess, setIsSuccess] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const controls = useAnimation();
  const x = useMotionValue(0);

  // Background color mapping: from light grey to green as we drag
  const background = useTransform(
    x,
    [0, 200], // Will be updated dynamically on mount
    ["#f3f4f6", "#22c55e"]
  );

  const opacity = useTransform(x, [0, 150], [1, 0]);

  const [maxWidth, setMaxWidth] = useState(300);

  useEffect(() => {
    if (containerRef.current && thumbRef.current) {
      setMaxWidth(containerRef.current.offsetWidth - thumbRef.current.offsetWidth - 8); // 8px padding (4px each side)
    }
  }, []);

  const handleDragEnd = async (event: any, info: any) => {
    if (isSuccess) return;

    if (info.offset.x > maxWidth * 0.75) { // If dragged more than 75%
      setIsSuccess(true);
      await controls.start({ x: maxWidth, transition: { duration: 0.2 } });
      onSuccess();
    } else {
      controls.start({ x: 0, transition: { type: "spring", stiffness: 300, damping: 20 } });
    }
  };

  if (isSuccess) {
    return (
      <div className="w-full h-14 bg-green-500 rounded-full flex items-center justify-center text-white font-bold tracking-wide">
        {successText}
      </div>
    );
  }

  return (
    <motion.div
      ref={containerRef}
      className="relative w-full h-14 rounded-full overflow-hidden border border-gray-200 flex items-center px-1"
      style={{ background }}
    >
      {/* Background Text */}
      <motion.div
        style={{ opacity }}
        className="absolute inset-0 flex items-center justify-center font-bold text-gray-500 pointer-events-none z-0"
      >
        {text}
      </motion.div>

      {/* Draggable Thumb */}
      <motion.div
        ref={thumbRef}
        drag="x"
        dragConstraints={containerRef}
        dragElastic={0.05}
        dragMomentum={false}
        onDragEnd={handleDragEnd}
        animate={controls}
        style={{ x }}
        className="w-12 h-12 bg-white rounded-full shadow-md z-10 flex items-center justify-center cursor-grab active:cursor-grabbing hover:scale-105 transition-transform"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
        </svg>
      </motion.div>
    </motion.div>
  );
}
