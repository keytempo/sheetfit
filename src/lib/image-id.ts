/**
 * A new id for a photo. Ids are saved with the photos and outlive the session, so they must never
 * repeat across sessions or tabs: a counter starting at 1 each time would hand out ids that saved
 * photos already have.
 */
export const newImageId = () => `image-${crypto.randomUUID()}`
