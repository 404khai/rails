export type JobProcessorMode = "inline" | "bullmq";

export type JobProcessor = {
  readonly mode: JobProcessorMode;
  enqueueReconciliation(payload: unknown, receivedAt: string): Promise<void>;
  enqueueOutboundDelivery(deliveryId: string): Promise<void>;
  close(): Promise<void>;
};
