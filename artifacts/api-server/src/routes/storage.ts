import { Readable } from "node:stream";
import { and, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  AddOrderAttachmentBody,
  AddOrderAttachmentParams,
  AddOrderAttachmentResponse,
  GetPrivateStorageObjectParams,
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import {
  db,
  orderAttachments,
  orderActivity,
  orderItems,
} from "@workspace/db";
import { requireAppUser } from "../lib/auth";
import { orderForUser, toIso } from "../lib/orderData";
import {
  ObjectNotFoundError,
  ObjectStorageService,
} from "../lib/objectStorage";

const router: IRouter = Router();
const storage = new ObjectStorageService();
const maxUploadSize = 25 * 1024 * 1024;

router.post(
  "/storage/uploads/request-url",
  requireAppUser,
  async (req, res): Promise<void> => {
    const parsed = RequestUploadUrlBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { orderId, itemId, name, size, contentType } = parsed.data;
    if (size > maxUploadSize) {
      res.status(413).json({ error: "Each attachment must be 25 MB or smaller." });
      return;
    }
    const order = await orderForUser(orderId, req.appUser!);
    if (!order) {
      res.status(404).json({ error: "Order not found." });
      return;
    }
    if (itemId !== undefined && itemId !== null) {
      const [item] = await db
        .select({ id: orderItems.id })
        .from(orderItems)
        .where(and(eq(orderItems.id, itemId), eq(orderItems.orderId, orderId)))
        .limit(1);
      if (!item) {
        res.status(400).json({ error: "Choose a product from this order." });
        return;
      }
    }
    try {
      const uploadURL = await storage.getObjectEntityUploadURL();
      const objectPath = storage.normalizeObjectEntityPath(uploadURL);
      res.json(
        RequestUploadUrlResponse.parse({
          uploadURL,
          objectPath,
          metadata: { orderId, itemId: itemId ?? null, name, size, contentType },
        }),
      );
    } catch (error) {
      req.log.error({ err: error }, "Could not create a private file upload URL");
      res.status(503).json({ error: "Private file storage is temporarily unavailable." });
    }
  },
);

router.post(
  "/orders/:orderId/attachments",
  requireAppUser,
  async (req, res): Promise<void> => {
    const params = AddOrderAttachmentParams.safeParse(req.params);
    const parsed = AddOrderAttachmentBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({ error: "Enter valid attachment details." });
      return;
    }
    const order = await orderForUser(params.data.orderId, req.appUser!);
    if (!order) {
      res.status(404).json({ error: "Order not found." });
      return;
    }
    const input = parsed.data;
    if (!input.objectPath.startsWith("/objects/uploads/")) {
      res.status(400).json({ error: "The attachment path is not valid." });
      return;
    }
    if (input.fileSize > maxUploadSize) {
      res.status(413).json({ error: "Each attachment must be 25 MB or smaller." });
      return;
    }
    if (input.itemId !== undefined && input.itemId !== null) {
      const [item] = await db
        .select({ id: orderItems.id })
        .from(orderItems)
        .where(
          and(
            eq(orderItems.id, input.itemId),
            eq(orderItems.orderId, params.data.orderId),
          ),
        )
        .limit(1);
      if (!item) {
        res.status(400).json({ error: "Choose a product from this order." });
        return;
      }
    }
    try {
      const object = await storage.getObjectEntityFile(input.objectPath);
      const [metadata] = await object.getMetadata();
      if (Number(metadata.size) !== input.fileSize) {
        res.status(400).json({ error: "The uploaded file size does not match." });
        return;
      }
      if (
        metadata.contentType &&
        metadata.contentType !== input.contentType &&
        input.contentType !== "application/octet-stream"
      ) {
        res.status(400).json({ error: "The uploaded file type does not match." });
        return;
      }
      const [attachment] = await db
        .insert(orderAttachments)
        .values({
          orderId: order.id,
          itemId: input.itemId ?? null,
          fileName: input.fileName.trim(),
          objectPath: input.objectPath,
          contentType: input.contentType,
          fileSize: input.fileSize,
          uploadedBy: req.appUser!.id,
        })
        .returning();
      await db.insert(orderActivity).values({
        orderId: order.id,
        actorUserId: req.appUser!.id,
        action: "attachment_added",
        summary: `تم إرفاق الملف: ${attachment.fileName}`,
      });
      res.status(201).json(
        AddOrderAttachmentResponse.parse({
          ...attachment,
          createdAt: toIso(attachment.createdAt),
        }),
      );
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(400).json({ error: "Upload the file before attaching it to this order." });
        return;
      }
      if ((error as { code?: string }).code === "23505") {
        res.status(409).json({ error: "This file is already attached." });
        return;
      }
      req.log.error({ err: error }, "Could not save order attachment metadata");
      res.status(503).json({ error: "The attachment could not be saved. Please try again." });
    }
  },
);

router.get(
  "/storage/objects/*objectPath",
  requireAppUser,
  async (req, res): Promise<void> => {
    const raw = req.params.objectPath;
    const key = Array.isArray(raw) ? raw.join("/") : raw;
    const parsed = GetPrivateStorageObjectParams.safeParse({ objectPath: key });
    if (!parsed.success || !key.startsWith("uploads/")) {
      res.status(404).json({ error: "File not found." });
      return;
    }
    const objectPath = `/objects/${parsed.data.objectPath}`;
    const [attachment] = await db
      .select()
      .from(orderAttachments)
      .where(eq(orderAttachments.objectPath, objectPath))
      .limit(1);
    if (!attachment || !(await orderForUser(attachment.orderId, req.appUser!))) {
      res.status(404).json({ error: "File not found." });
      return;
    }
    try {
      const object = await storage.getObjectEntityFile(objectPath);
      const response = await storage.downloadObject(object, 0);
      res.status(response.status);
      response.headers.forEach((value, name) => res.setHeader(name, value));
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
      );
      if (response.body) {
        Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "File not found." });
        return;
      }
      req.log.error({ err: error }, "Could not read a private order attachment");
      res.status(503).json({ error: "File download is temporarily unavailable." });
    }
  },
);

export default router;
