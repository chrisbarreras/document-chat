// SPDX-License-Identifier: Apache-2.0
import { NextResponse } from 'next/server';
import pkg from '../../../package.json';

export async function GET(_request: Request): Promise<NextResponse> {
  return NextResponse.json({
    status: 'ok',
    version: pkg.version,
    checks: [],
  });
}
