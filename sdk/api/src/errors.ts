/**
 * The codes of the errors the app throws from the API. A plugin reads `error.code`
 * and always keeps a default branch: a minor release may add a code.
 *
 * Added in 1.3.0: `INTERNAL` (an error inside the app, not caused by the call) and the codes of
 * `ctx.net`: `ABORTED`, `INVALID_URL`, `NETWORK_DISABLED`, `NETWORK_TIMEOUT`, `PRIVATE_ADDRESS`,
 * `SECRET_MISSING`, `TOO_MANY_STREAMS`.
 *
 * @since 1.0.0
 */
export type PluginErrorCode =
  | "ABORTED"
  | "CONFLICT"
  | "DRAWING_CHANGED"
  | "FONT_UNAVAILABLE"
  | "INTERNAL"
  | "INVALID_ARGUMENT"
  | "INVALID_FILE"
  | "INVALID_PATH"
  | "INVALID_URL"
  | "IO_ERROR"
  | "NAME_COLLISION"
  | "NETWORK_DISABLED"
  | "NETWORK_ERROR"
  | "NETWORK_NOT_ALLOWED"
  | "NETWORK_TIMEOUT"
  | "NO_VAULT"
  | "NO_VERSION"
  | "NOT_FOUND"
  | "NOT_SUPPORTED"
  | "PERMISSION"
  | "PRIVATE_ADDRESS"
  | "QUOTA"
  | "READ_ONLY"
  | "SECRET_MISSING"
  | "TIMEOUT"
  | "TOO_LARGE"
  | "TOO_MANY_STREAMS";

/**
 * What a refused call rejects or throws with. Check it with
 * `isPluginApiError(e)` style code: `e instanceof Error && "code" in e`.
 * `issues` is set for `ctx.scene.batch` refusals.
 *
 * @since 1.0.0
 */
export interface PluginApiError extends Error {
  readonly name: "PluginApiError";
  readonly code: PluginErrorCode;
  readonly issues?: readonly import("./scene").SceneOpIssue[];
}
