import {
  Args,
  Mutation,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import { Role } from 'src/util/constants';

import { AuthUser, CurrentUser } from '@/auth/current-user';
import { Roles } from '@/auth/roles.decorator';
import { FormsService } from '@/forms/forms.service';
import { UsersService } from '@/users/users.service';

import { Form } from '../entities/form.entity';
import { User } from '../entities/user.entity';
import { CreateUserInput } from '../inputs/create-user-input';
import { ListFiltersInput } from '../inputs/list-filters-input';
import { UpdateUserInput } from '../inputs/update-user-input';

@Resolver(() => User)
export class UsersResolver {
  constructor(
    private usersService: UsersService,
    private formsService: FormsService,
  ) {}

  @Query(() => User)
  @Roles(Role.Admin)
  user(@Args('userAuthId') authUserId: string) {
    return this.usersService.findUserByAuthUserId(authUserId);
  }

  @Query(() => [User])
  @Roles(Role.Admin)
  users(
    @Args('filter', { type: () => ListFiltersInput, nullable: true })
    filter: ListFiltersInput,
  ) {
    return this.usersService.findAll(filter);
  }

  @ResolveField(() => [Form])
  forms(@Parent() user: User) {
    return this.formsService.listAllFromUserByUserId(user.id);
  }

  @Mutation(() => User)
  createUser(
    @Args('data') data: CreateUserInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.usersService.createUser({ authUserId: user.sub, ...data });
  }

  @Mutation(() => User)
  updateUser(
    @Args('data') data: UpdateUserInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.usersService.updateUser({ authUserId: user.sub, ...data });
  }
}
