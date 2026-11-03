"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { CoffeeArt } from "@/components/CoffeeArt";
import { Icon } from "@/components/Icons";

const steps = [
  {
    title: "Scan and browse",
    description:
      "Open your table QR code and browse the live menu, including current availability and low-portion items.",
    label: "01 · Browse the menu",
  },
  {
    title: "Build your order",
    description:
      "Choose drinks and food, customize your selections, and review the cart before sending it to the cafe.",
    label: "02 · Customize your order",
  },
  {
    title: "Choose payment",
    description:
      "Select an available payment method and submit your order for staff review and confirmation.",
    label: "03 · Submit payment",
  },
  {
    title: "Follow progress",
    description:
      "Check the order status and queue as the cafe team confirms, prepares, and serves your order.",
    label: "04 · Track your order",
  },
];

export function SystemWalkthrough() {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => {
      setStep((current) => (current + 1) % steps.length);
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [playing, step]);

  const startOrPause = () => {
    setPlaying((current) => !current);
  };

  const selectStep = (index: number) => {
    setStep(index);
    setPlaying(false);
  };

  return (
    <div className="walkthrough" aria-label="Interactive ordering demo">
      <div className="walkthrough-screen">
        <div className="walkthrough-toolbar">
          <span className="walkthrough-brand">
            <Image
              src="/merrylane-logo-black.png"
              alt="Merrylane Cafe"
              width={441}
              height={193}
              className="walkthrough-logo"
            />
          </span>
          <span className="walkthrough-table">TABLE 07</span>
          <span className="walkthrough-bag">
            <Icon name="bag" size={14} /> <span>2</span>
          </span>
        </div>

        <div className={`walkthrough-scene scene-${step + 1}`} key={step}>
          <div className="walkthrough-copy" aria-live="polite">
            <span className="walkthrough-step-label">{steps[step].label}</span>
            <h3>{steps[step].title}</h3>
            <p>{steps[step].description}</p>
          </div>

          <div className="walkthrough-preview" aria-hidden="true">
            {step === 0 && (
              <div className="demo-menu">
                <span className="demo-screen-title">Today&apos;s favorites</span>
                <div className="demo-menu-item">
                  <span className="demo-item-thumb">
                    <CoffeeArt variant="icon" className="demo-product-art" />
                  </span>
                  <span><b>Spanish latte</b><small>₱150 · Available</small></span>
                  <Icon name="plus" size={13} />
                </div>
                <div className="demo-menu-item">
                  <span className="demo-item-thumb pastry-thumb">
                    <CoffeeArt
                      kind="pastry"
                      variant="icon"
                      className="demo-product-art"
                    />
                  </span>
                  <span><b>Butter croissant</b><small>₱95 · Low portions</small></span>
                  <Icon name="plus" size={13} />
                </div>
              </div>
            )}
            {step === 1 && (
              <div className="demo-cart">
                <span className="demo-screen-title">Your order</span>
                <div className="demo-cart-line"><b>Spanish latte</b><span>₱150</span></div>
                <div className="demo-cart-line"><b>Butter croissant</b><span>₱95</span></div>
                <div className="demo-cart-total"><b>Total</b><b>₱245</b></div>
                <span className="demo-next-button">Review order <Icon name="arrow-right" size={11} /></span>
              </div>
            )}
            {step === 2 && (
              <div className="demo-payment">
                <span className="demo-screen-title">Choose payment</span>
                <span className="demo-payment-option selected"><Icon name="card" size={14} /><b>GCash</b><Icon name="check-circle" size={14} /></span>
                <span className="demo-payment-option"><Icon name="users" size={14} /><b>Cash at counter</b></span>
                <span className="demo-next-button">Place order <Icon name="arrow-right" size={11} /></span>
              </div>
            )}
            {step === 3 && (
              <div className="demo-status">
                <span className="demo-status-icon"><Icon name="check" size={18} /></span>
                <span className="demo-screen-title">Order received</span>
                <span className="demo-queue">Queue number <b>A-014</b></span>
                <span className="demo-progress">
                  <i className="done" /><i className="done" /><i /><i />
                </span>
                <span className="demo-status-caption">Being prepared</span>
              </div>
            )}
          </div>
        </div>

        <div className="walkthrough-controls">
          <button
            type="button"
            className="walkthrough-play"
            onClick={startOrPause}
            aria-label={playing ? "Pause demo" : step === steps.length - 1 ? "Replay demo" : "Play demo"}
          >
            <span
              className={`walkthrough-control-icon ${playing ? "pause" : "play"}`}
              aria-hidden="true"
            />
          </button>
          <div
            className="walkthrough-progress"
            role="progressbar"
            aria-label="Demo progress"
            aria-valuemin={1}
            aria-valuemax={steps.length}
            aria-valuenow={step + 1}
          >
            <span style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
          </div>
          <span className="walkthrough-count">
            {String(step + 1).padStart(2, "0")} / {String(steps.length).padStart(2, "0")}
          </span>
        </div>
      </div>

      <div className="walkthrough-steps" aria-label="Demo steps">
        {steps.map((item, index) => (
          <button
            type="button"
            key={item.label}
            className={`walkthrough-step${step === index ? " active" : ""}`}
            onClick={() => selectStep(index)}
            aria-current={step === index ? "step" : undefined}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            {item.title}
          </button>
        ))}
      </div>
      <p className="walkthrough-note">Interactive preview · illustrative demo, not a live order</p>
    </div>
  );
}
