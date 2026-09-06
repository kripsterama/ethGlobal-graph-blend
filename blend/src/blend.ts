import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  LoanOfferTaken,
  Repay,
  Refinance,
  StartAuction,
  Seize,
  BuyLocked,
} from "../generated/Blend/Blend";
import { Lien, Account, LienEvent } from "../generated/schema";

function getOrCreateAccount(address: Bytes): Account {
  let account = Account.load(address.toHex());
  if (account == null) {
    account = new Account(address.toHex());
    account.save();
  }
  return account as Account;
}

function logLienEvent(
  lienId: string,
  eventType: string,
  txHash: Bytes,
  logIndex: BigInt,
  timestamp: BigInt,
  block: BigInt
): void {
  let id = txHash.toHex() + "-" + logIndex.toString();
  let event = new LienEvent(id);
  event.lien = lienId;
  event.eventType = eventType;
  event.txHash = txHash;
  event.timestamp = timestamp;
  event.block = block;
  event.save();
}

export function handleLoanOfferTaken(event: LoanOfferTaken): void {
  let lienId = event.params.lienId.toString();

  let borrower = getOrCreateAccount(event.params.borrower);
  let lender = getOrCreateAccount(event.params.lender);

  let lien = new Lien(lienId);
  lien.borrower = borrower.id;
  lien.lender = lender.id;
  lien.collection = event.params.collection;
  lien.tokenId = event.params.tokenId;
  lien.loanAmount = event.params.loanAmount;
  lien.rate = event.params.rate;
  lien.auctionDuration = event.params.auctionDuration;
  lien.status = "ACTIVE";
  lien.auctionStartBlock = null;
  lien.interestStartTimestamp = event.block.timestamp;
  lien.createdAtBlock = event.block.number;
  lien.createdAtTimestamp = event.block.timestamp;
  lien.updatedAtBlock = event.block.number;
  lien.updatedAtTimestamp = event.block.timestamp;
  lien.save();

  logLienEvent(
    lienId,
    "LoanOfferTaken",
    event.transaction.hash,
    event.logIndex,
    event.block.timestamp,
    event.block.number
  );
}

export function handleRepay(event: Repay): void {
  let lienId = event.params.lienId.toString();
  let lien = Lien.load(lienId);
  if (lien == null) {
    // Lien wasn't captured at LoanOfferTaken (e.g. predates start block) — skip.
    return;
  }

  lien.status = "REPAID";
  lien.updatedAtBlock = event.block.number;
  lien.updatedAtTimestamp = event.block.timestamp;
  lien.save();

  logLienEvent(
    lienId,
    "Repay",
    event.transaction.hash,
    event.logIndex,
    event.block.timestamp,
    event.block.number
  );
}

export function handleRefinance(event: Refinance): void {
  let lienId = event.params.lienId.toString();
  let lien = Lien.load(lienId);
  if (lien == null) {
    return;
  }

  let newLender = getOrCreateAccount(event.params.newLender);

  lien.lender = newLender.id;
  lien.loanAmount = event.params.newAmount;
  lien.rate = event.params.newRate;
  lien.auctionDuration = event.params.newAuctionDuration;
  lien.status = "ACTIVE"; // clears any prior auction state
  lien.auctionStartBlock = null;
  lien.interestStartTimestamp = event.block.timestamp; // new loan terms reset the interest clock
  lien.updatedAtBlock = event.block.number;
  lien.updatedAtTimestamp = event.block.timestamp;
  lien.save();

  logLienEvent(
    lienId,
    "Refinance",
    event.transaction.hash,
    event.logIndex,
    event.block.timestamp,
    event.block.number
  );
}

export function handleStartAuction(event: StartAuction): void {
  let lienId = event.params.lienId.toString();
  let lien = Lien.load(lienId);
  if (lien == null) {
    return;
  }

  lien.status = "IN_AUCTION";
  lien.auctionStartBlock = event.block.number;
  lien.updatedAtBlock = event.block.number;
  lien.updatedAtTimestamp = event.block.timestamp;
  lien.save();

  logLienEvent(
    lienId,
    "StartAuction",
    event.transaction.hash,
    event.logIndex,
    event.block.timestamp,
    event.block.number
  );
}

export function handleSeize(event: Seize): void {
  let lienId = event.params.lienId.toString();
  let lien = Lien.load(lienId);
  if (lien == null) {
    return;
  }

  lien.status = "SEIZED";
  lien.updatedAtBlock = event.block.number;
  lien.updatedAtTimestamp = event.block.timestamp;
  lien.save();

  logLienEvent(
    lienId,
    "Seize",
    event.transaction.hash,
    event.logIndex,
    event.block.timestamp,
    event.block.number
  );
}

export function handleBuyLocked(event: BuyLocked): void {
  let lienId = event.params.lienId.toString();
  let lien = Lien.load(lienId);
  if (lien == null) {
    return;
  }

  lien.status = "SOLD_LOCKED";
  lien.updatedAtBlock = event.block.number;
  lien.updatedAtTimestamp = event.block.timestamp;
  lien.save();

  logLienEvent(
    lienId,
    "BuyLocked",
    event.transaction.hash,
    event.logIndex,
    event.block.timestamp,
    event.block.number
  );
}