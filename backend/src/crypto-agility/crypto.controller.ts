import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { SignDto, VerifyDto } from './dto/signing.dto';
import { SigningService } from './signing.service';

@Controller('crypto')
export class CryptoController {
  constructor(private readonly signing: SigningService) {}

  // GET /api/crypto/providers -> every algorithm, which one is active, availability, sizes and speed
  @Get('providers')
  providers() {
    return this.signing.describeProviders();
  }

  // POST /api/crypto/sign { message, algorithm? } -> signed envelope. Admin only: it signs with the server's key.
  @Post('sign')
  @Roles('admin')
  @HttpCode(200)
  sign(@Body() body: SignDto) {
    return this.signing.sign(body.message, body.algorithm);
  }

  // POST /api/crypto/verify { message, algorithm, signature, keyId | publicKey } -> { valid }
  // A POST that changes nothing, so viewers may use it too. Stated explicitly: the route audit test
  // requires every non-GET route to declare who may call it.
  @Post('verify')
  @Roles('admin', 'viewer')
  @HttpCode(200)
  verify(@Body() body: VerifyDto) {
    return this.signing.verify(body);
  }
}
