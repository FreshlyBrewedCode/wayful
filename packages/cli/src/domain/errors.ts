import { Data } from "effect";

export class WayfulError extends Data.TaggedError("WayfulError")<{
  readonly message: string;
}> {}

export class MapMetadataError extends Data.TaggedError("MapMetadataError")<{
  readonly message: string;
}> {}
