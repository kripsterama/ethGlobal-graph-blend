import {
  assert,
  describe,
  test,
  clearStore,
  beforeAll,
  afterAll
} from "matchstick-as/assembly/index"
import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts"
import { handleLoanOfferTaken } from "../src/blend"
import { createLoanOfferTakenEvent } from "./blend-utils"

const LIEN_ID = "1"
const BORROWER = "0x00000000000000000000000000000000000000b0"
const LENDER = "0x00000000000000000000000000000000000000e1"
const COLLECTION = "0x000000000000000000000000000000000000c001"

describe("handleLoanOfferTaken", () => {
  beforeAll(() => {
    let offerHash = Bytes.fromI32(1234567890)
    let lienId = BigInt.fromString(LIEN_ID)
    let collection = Address.fromString(COLLECTION)
    let lender = Address.fromString(LENDER)
    let borrower = Address.fromString(BORROWER)
    let loanAmount = BigInt.fromString("1000000000000000000")
    let rate = BigInt.fromI32(500)
    let tokenId = BigInt.fromI32(42)
    let auctionDuration = BigInt.fromI32(86400)

    let event = createLoanOfferTakenEvent(
      offerHash,
      lienId,
      collection,
      lender,
      borrower,
      loanAmount,
      rate,
      tokenId,
      auctionDuration
    )
    handleLoanOfferTaken(event)
  })

  afterAll(() => {
    clearStore()
  })

  test("creates a Lien with fields from the event", () => {
    assert.entityCount("Lien", 1)
    assert.fieldEquals("Lien", LIEN_ID, "borrower", BORROWER)
    assert.fieldEquals("Lien", LIEN_ID, "lender", LENDER)
    assert.fieldEquals("Lien", LIEN_ID, "collection", COLLECTION)
    assert.fieldEquals("Lien", LIEN_ID, "tokenId", "42")
    assert.fieldEquals("Lien", LIEN_ID, "loanAmount", "1000000000000000000")
    assert.fieldEquals("Lien", LIEN_ID, "rate", "500")
    assert.fieldEquals("Lien", LIEN_ID, "auctionDuration", "86400")
    assert.fieldEquals("Lien", LIEN_ID, "status", "ACTIVE")
    assert.fieldEquals("Lien", LIEN_ID, "auctionStartBlock", "null")
  })

  test("creates borrower and lender Accounts", () => {
    assert.entityCount("Account", 2)
  })

  test("logs a LienEvent for the loan origination", () => {
    assert.entityCount("LienEvent", 1)
  })
})
