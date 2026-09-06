import {
  AdminChanged,
  BeaconUpgraded,
  Upgraded
} from "../generated/ERC1967Proxy/ERC1967Proxy"

export function handleAdminChanged(event: AdminChanged): void {}

export function handleBeaconUpgraded(event: BeaconUpgraded): void {}

export function handleUpgraded(event: Upgraded): void {}
