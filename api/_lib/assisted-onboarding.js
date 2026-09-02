const crypto = require("crypto");

class AssistedOnboardingValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "AssistedOnboardingValidationError";
    this.statusCode = 400;
  }
}

function cleanText(value, maxLength = 160) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function normaliseIrishPhone(value) {
  let phone = String(value || "").trim().replace(/[\s().-]/g, "");
  if (phone.startsWith("00")) phone = `+${phone.slice(2)}`;
  if (phone.startsWith("353")) phone = `+${phone}`;
  if (phone.startsWith("0")) phone = `+353${phone.slice(1)}`;
  if (!/^\+\d{8,15}$/.test(phone)) {
    throw new AssistedOnboardingValidationError(
      "Enter the contact phone in Irish or international format."
    );
  }
  return phone;
}

function ibanMod97(iban) {
  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
  let remainder = 0;

  for (const character of rearranged) {
    const numeric = /[A-Z]/.test(character)
      ? String(character.charCodeAt(0) - 55)
      : character;
    for (const digit of numeric) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }

  return remainder;
}

function normaliseIrishIban(value) {
  const iban = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^IE\d{2}[A-Z]{4}\d{14}$/.test(iban) || ibanMod97(iban) !== 1) {
    throw new AssistedOnboardingValidationError("Enter a valid 22-character Irish IBAN.");
  }
  return iban;
}

function normaliseEircode(value) {
  const compact = String(value || "").toUpperCase().replace(/\s+/g, "");
  if (!/^[AC-FHKNPRTV-Y]\d{2}[AC-FHKNPRTV-Y0-9]{4}$/.test(compact)) {
    throw new AssistedOnboardingValidationError("Enter a valid Eircode.");
  }
  return `${compact.slice(0, 3)} ${compact.slice(3)}`;
}

function parseDateOfBirth(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
  if (!match) {
    throw new AssistedOnboardingValidationError("Enter the representative's date of birth.");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw new AssistedOnboardingValidationError("Enter a valid date of birth.");
  }

  const today = new Date();
  let age = today.getUTCFullYear() - year;
  const beforeBirthday = (today.getUTCMonth() + 1 < month)
    || (today.getUTCMonth() + 1 === month && today.getUTCDate() < day);
  if (beforeBirthday) age -= 1;
  if (age < 18 || age > 120) {
    throw new AssistedOnboardingValidationError(
      "The Stripe representative must be at least 18 years old."
    );
  }

  return { day, month, year };
}

function validateEmail(value) {
  const email = cleanText(value, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AssistedOnboardingValidationError("Enter a valid business email address.");
  }
  return email;
}

function requireText(value, label, minLength = 2, maxLength = 160) {
  const text = cleanText(value, maxLength);
  if (text.length < minLength) {
    throw new AssistedOnboardingValidationError(`${label} is required.`);
  }
  return text;
}

function validateAssistedOnboardingInput(body) {
  const pubId = Number(body?.pubId);
  if (!Number.isInteger(pubId) || pubId <= 0) {
    throw new AssistedOnboardingValidationError("Choose a PintDrop pub.");
  }

  const businessType = body?.businessType === "company" ? "company" : "individual";
  const representativeFirstName = requireText(body?.representativeFirstName, "First name", 1, 80);
  const representativeLastName = requireText(body?.representativeLastName, "Last name", 1, 80);
  const legalName = businessType === "company"
    ? requireText(body?.legalName, "Legal company name", 2, 160)
    : `${representativeFirstName} ${representativeLastName}`;
  const accountHolderName = cleanText(body?.accountHolderName, 160) || legalName;
  const addressLine1 = requireText(body?.addressLine1, "Business address", 3, 160);
  const addressLine2 = cleanText(body?.addressLine2, 160);
  const city = requireText(body?.city, "Town or city", 2, 100);

  return {
    pubId,
    businessType,
    legalName,
    accountHolderName,
    representativeFirstName,
    representativeLastName,
    representativeDob: parseDateOfBirth(body?.representativeDob),
    email: validateEmail(body?.email),
    phone: normaliseIrishPhone(body?.phone),
    address: {
      line1: addressLine1,
      ...(addressLine2 ? { line2: addressLine2 } : {}),
      city,
      postal_code: normaliseEircode(body?.postalCode),
      country: "IE"
    },
    iban: normaliseIrishIban(body?.iban)
  };
}

function buildStripeAccountCreateParams(pub, details) {
  const pubName = requireText(pub?.name, "Pub name", 2, 120);
  const common = {
    type: "express",
    country: "IE",
    default_currency: "eur",
    email: details.email,
    business_type: details.businessType,
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true }
    },
    business_profile: {
      name: pubName,
      mcc: "5813",
      product_description: "Drinks sold by an Irish pub and PintDrop drink vouchers redeemed at the venue.",
      support_email: details.email,
      support_phone: details.phone
    },
    external_account: {
      object: "bank_account",
      country: "IE",
      currency: "eur",
      account_number: details.iban,
      account_holder_name: details.accountHolderName,
      account_holder_type: details.businessType
    },
    metadata: {
      pub_id: String(details.pubId),
      pintdrop_pub_id: String(details.pubId),
      pub_name: pubName,
      preview_only: "true",
      assisted_onboarding: "true"
    }
  };

  if (details.businessType === "company") {
    common.company = {
      name: details.legalName,
      phone: details.phone,
      address: details.address
    };
  } else {
    common.individual = {
      first_name: details.representativeFirstName,
      last_name: details.representativeLastName,
      email: details.email,
      phone: details.phone,
      dob: details.representativeDob,
      address: details.address
    };
  }

  return common;
}

function buildStripeRepresentativeParams(details) {
  if (details.businessType !== "company") return null;
  return {
    first_name: details.representativeFirstName,
    last_name: details.representativeLastName,
    email: details.email,
    phone: details.phone,
    dob: details.representativeDob,
    address: details.address,
    relationship: {
      representative: true
    }
  };
}

function buildAssistedIdempotencyKey(details) {
  const pubId = Number(details?.pubId);
  const digest = crypto
    .createHash("sha256")
    .update(JSON.stringify({
      pubId,
      businessType: details?.businessType,
      legalName: details?.legalName,
      representativeFirstName: details?.representativeFirstName,
      representativeLastName: details?.representativeLastName,
      representativeDob: details?.representativeDob,
      email: details?.email,
      phone: details?.phone,
      address: details?.address,
      accountHolderName: details?.accountHolderName,
      iban: details?.iban
    }))
    .digest("hex")
    .slice(0, 28);
  return `pintdrop-preview-assisted-${pubId}-${digest}`;
}

module.exports = {
  AssistedOnboardingValidationError,
  normaliseIrishPhone,
  normaliseIrishIban,
  normaliseEircode,
  parseDateOfBirth,
  validateAssistedOnboardingInput,
  buildStripeAccountCreateParams,
  buildStripeRepresentativeParams,
  buildAssistedIdempotencyKey
};
