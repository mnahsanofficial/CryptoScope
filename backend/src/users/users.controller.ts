import { Body, Controller, Get, Post } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { CreateUserDto } from './dto/user.dto';
import { PublicUser, UsersService } from './users.service';

/** User management: admins only. */
@Controller('users')
@Roles('admin')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  // POST /api/users { email, password, role }
  @Post()
  create(@Body() body: CreateUserDto): Promise<PublicUser> {
    return this.users.create(body.email, body.password, body.role);
  }

  @Get()
  list(): Promise<PublicUser[]> {
    return this.users.list();
  }
}
