import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AppConfig } from '../config/configuration';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JWT_AUDIENCE, JWT_ISSUER } from './auth.types';

@Global() // AuthService is needed by the global guard and the Socket.IO gateway
@Module({
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const { jwtSecret, jwtExpiresIn } = config.getOrThrow<AppConfig['auth']>('auth');
        return {
          secret: jwtSecret,
          signOptions: {
            algorithm: 'HS256',
            expiresIn: jwtExpiresIn as `${number}${'s' | 'm' | 'h' | 'd'}`,
            issuer: JWT_ISSUER,
            audience: JWT_AUDIENCE,
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
