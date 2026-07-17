import type { EmailIntakeAdapter, ParsedRequest } from './adapter.js';

// Deterministic heuristic parser standing in for Outlook/Graph intake.
// Low-confidence parses are flagged needsReview so a human confirms before a request is created.
export class MockEmailIntakeAdapter implements EmailIntakeAdapter {
  splitMessages(rawText: string): string[] {
    // Blank line(s) or a line of dashes separate individual pasted emails.
    return rawText
      .split(/\n\s*\n|\n-{3,}\n/g)
      .map((b) => b.trim())
      .filter((b) => b.length > 0);
  }

  parse(message: string): ParsedRequest {
    let confidence = 0.4;

    const emailMatch = message.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    if (emailMatch) confidence += 0.2;

    const qtyMatch = message.match(/(\d+)\s*(?:tickets?|tix|seats?|passes?)/i) ?? message.match(/(?:need|want|request(?:ing)?)\s*(\d+)/i);
    const quantity = qtyMatch ? Math.max(1, parseInt(qtyMatch[1], 10)) : 1;
    if (qtyMatch) confidence += 0.2;

    const teamMatch = message.match(/golden knights|vgk|aviators|lights|desert dogs|knights/i);
    if (teamMatch) confidence += 0.1;

    const oppDateMatch =
      message.match(/(?:vs\.?|against|opponent[:\s])\s*([A-Za-z .]{3,40})/i) ??
      message.match(/\b(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/) ??
      message.match(/\b(\d{4}-\d{2}-\d{2})\b/);

    const moneyMatch = message.match(/\$\s*([\d,]+(?:\.\d+)?)/);
    const salesOpportunityUsd = moneyMatch ? Number(moneyMatch[1].replace(/,/g, '')) : undefined;
    if (moneyMatch) confidence += 0.1;

    // First non-empty line is usually the sender's name or greeting.
    const firstLine = message.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
    const nameMatch =
      message.match(/(?:from|name|regards,|thanks,|thank you,|-)\s*\n?\s*([A-Z][a-z]+\s+[A-Z][a-z]+)/) ??
      (/^[A-Z][a-z]+\s+[A-Z][a-z]+$/.test(firstLine) ? [firstLine, firstLine] : null);

    const companyMatch = message.match(/(?:company|from|at|with)\s*[:\-]?\s*([A-Z][\w& .,'-]{2,40}(?:Inc\.?|LLC|Corp\.?|Co\.?|Group|Ltd\.?)?)/);

    const isEmployee = /employee|internal|staff|team member/i.test(message);

    confidence = Math.min(1, confidence);

    return {
      requesterName: nameMatch?.[1]?.trim(),
      requesterEmail: emailMatch?.[0],
      requesterCompany: companyMatch?.[1]?.trim(),
      teamHint: teamMatch?.[0],
      opponentOrDateHint: oppDateMatch?.[1]?.trim(),
      quantity,
      beneficiaryType: isEmployee ? 'employee' : 'customer',
      salesOpportunityUsd,
      notes: message.length > 400 ? message.slice(0, 400) + '…' : message,
      confidence,
      needsReview: confidence < 0.7 || !emailMatch,
      rawText: message,
    };
  }
}
