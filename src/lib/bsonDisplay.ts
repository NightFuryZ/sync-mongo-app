/**
 * Format canonical Extended JSON BSON values into human-readable strings.
 * Handles common BSON wrappers: ObjectId, NumberLong, NumberInt, NumberDouble,
 * Date, UUID, Binary, Timestamp, etc.
 * 
 * This is display-only and does not mutate data.
 */

/**
 * Helper to properly escape and quote strings for display.
 * Uses JSON.stringify to ensure quotes, backslashes, newlines, etc. are handled correctly.
 */
function quoteString(str: unknown): string {
  return JSON.stringify(str);
}

/**
 * Check if a value looks like a BSON Extended JSON wrapper object.
 * Returns the wrapper key if detected (e.g., "$oid", "$numberLong"), otherwise null.
 */
function detectBsonWrapper(val: unknown): string | null {
  if (typeof val !== "object" || val === null || Array.isArray(val)) {
    return null;
  }
  const keys = Object.keys(val);
  if (keys.length === 0) return null;
  
  // Handle single-key wrappers
  if (keys.length === 1) {
    const key = keys[0];
    const singleKeyBsonTypes = [
      "$oid",
      "$numberLong",
      "$numberInt",
      "$numberDouble",
      "$numberDecimal",
      "$date",
      "$binary",
      "$uuid",
      "$timestamp",
      "$regularExpression",
      "$minKey",
      "$maxKey",
      "$undefined",
      "$symbol",
      "$code",
    ];
    
    return singleKeyBsonTypes.includes(key) ? key : null;
  }
  
  // Handle multi-key wrappers: code-with-scope
  if (keys.length === 2 && keys.includes("$code") && keys.includes("$scope")) {
    return "$code";
  }
  
  return null;
}

/**
 * Format a BSON Extended JSON value into a human-readable string.
 * For wrapper objects like { "$oid": "abc123" }, returns ObjectId("abc123").
 * For nested objects that contain BSON wrappers, treats them as leaf values.
 * For all other values, returns JSON.stringify.
 */
export function formatBsonValue(val: unknown): string {
  if (val === null) return "null";
  if (val === undefined) return "undefined";
  if (typeof val !== "object") return String(val);
  
  const wrapper = detectBsonWrapper(val);
  if (wrapper) {
    const obj = val as Record<string, unknown>;
    
    switch (wrapper) {
      case "$oid":
        return `ObjectId(${quoteString(obj[wrapper])})`;
      
      case "$numberLong":
        return `NumberLong(${quoteString(obj[wrapper])})`;
      
      case "$numberInt":
        return `NumberInt(${obj[wrapper]})`;
      
      case "$numberDouble":
        return `NumberDouble(${obj[wrapper]})`;
      
      case "$numberDecimal":
        return `NumberDecimal(${quoteString(obj[wrapper])})`;
      
      case "$date":
        // $date can be a string (ISO) or an object with $numberLong
        const dateVal = obj[wrapper];
        if (typeof dateVal === "string") {
          return `Date(${quoteString(dateVal)})`;
        } else if (typeof dateVal === "object" && dateVal !== null) {
          const innerWrapper = detectBsonWrapper(dateVal);
          if (innerWrapper === "$numberLong") {
            return `Date(${(dateVal as Record<string, unknown>)[innerWrapper]})`;
          }
        }
        return `Date(${JSON.stringify(dateVal)})`;
      
      case "$binary":
        // $binary has { base64: "...", subType: "..." }
        const binaryVal = obj[wrapper] as Record<string, unknown>;
        const base64 = binaryVal?.base64 || "";
        const subType = binaryVal?.subType || "00";
        return `Binary(${quoteString(base64)}, ${quoteString(subType)})`;
      
      case "$uuid":
        return `UUID(${quoteString(obj[wrapper])})`;
      
      case "$timestamp":
        // $timestamp has { t: number, i: number }
        const tsVal = obj[wrapper] as Record<string, unknown>;
        return `Timestamp(${tsVal?.t || 0}, ${tsVal?.i || 0})`;
      
      case "$regularExpression":
        // $regularExpression has { pattern: "...", options: "..." }
        const reVal = obj[wrapper] as Record<string, unknown>;
        return `RegExp(${quoteString(reVal?.pattern || "")}, ${quoteString(reVal?.options || "")})`;
      
      case "$code":
        // Handle code-with-scope: { "$code": "...", "$scope": { ... } }
        if ("$scope" in obj) {
          const codeStr = obj["$code"];
          const scopeObj = obj["$scope"];
          return `Code(${quoteString(codeStr)}, ${JSON.stringify(scopeObj)})`;
        }
        // Plain code: { "$code": "..." }
        return `Code(${quoteString(obj[wrapper])})`;
      
      case "$minKey":
        return "MinKey()";
      
      case "$maxKey":
        return "MaxKey()";
      
      case "$undefined":
        return "undefined";
      
      case "$symbol":
        return `Symbol(${quoteString(obj[wrapper])})`;
      
      default:
        return JSON.stringify(val);
    }
  }
  
  // Not a BSON wrapper, stringify normally
  return JSON.stringify(val);
}

/**
 * Check if a value is a BSON Extended JSON wrapper that should be treated
 * as a leaf value (not recursed into).
 */
export function isBsonWrapper(val: unknown): boolean {
  return detectBsonWrapper(val) !== null;
}

/**
 * Recursively format a value for display, humanizing any nested BSON wrappers
 * found inside normal objects or arrays.
 * 
 * Use this for displaying composite key values or any context where you want
 * nested BSON wrappers to be human-readable.
 * 
 * Display-only, does not mutate data.
 */
export function formatBsonValueRecursive(val: unknown): string {
  if (val === null) return "null";
  if (val === undefined) return "undefined";
  
  // Check if this value itself is a BSON wrapper
  const wrapper = detectBsonWrapper(val);
  if (wrapper) {
    return formatBsonValue(val);
  }
  
  // Handle arrays: recursively format each element
  if (Array.isArray(val)) {
    const formatted = val.map(item => formatBsonValueRecursive(item));
    return `[${formatted.join(", ")}]`;
  }
  
  // Handle plain objects: recursively format each property
  if (typeof val === "object" && val !== null) {
    const obj = val as Record<string, unknown>;
    const entries = Object.entries(obj).map(([key, value]) => {
      const formattedValue = formatBsonValueRecursive(value);
      return `${quoteString(key)}: ${formattedValue}`;
    });
    return `{${entries.join(", ")}}`;
  }
  
  // Primitives: strings need quotes, others don't
  if (typeof val === "string") {
    return quoteString(val);
  }
  
  return String(val);
}
