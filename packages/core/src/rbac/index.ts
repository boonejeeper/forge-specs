export {
  PERMISSIONS,
  ROLE_CAPABILITIES,
  ROLE_RANK,
  roleHasPermission,
  capabilitiesForRole,
  type Permission,
} from "./permissions";
export {
  ForbiddenError,
  UnauthorizedError,
  isForbiddenError,
} from "./errors";
export {
  resolveEffectiveRole,
  type Scope,
  type MembershipLike,
} from "./scope";
export {
  setRbacProvider,
  getRbacProvider,
  resetRbacProvider,
  type RbacContextProvider,
} from "./context";
export {
  requirePermission,
  withPermission,
  type AuthorizedActor,
} from "./require-permission";
export { Role } from "@forgespecs/db";
