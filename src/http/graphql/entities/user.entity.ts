import { ObjectType, Field, registerEnumType, ID } from '@nestjs/graphql';
import { Form } from './form.entity';

export enum ProfileType {
  HODLER = 'HODLER',
  RECYCLER = 'RECYCLER',
  WASTE_GENERATOR = 'WASTE_GENERATOR',
}

registerEnumType(ProfileType, {
  name: 'ProfileType',
  description: 'Represents the user type',
});

@ObjectType()
export class User {
  id: string;

  @Field(() => ID, { description: 'Auth0 User ID' })
  authUserId: string;

  @Field(() => ProfileType)
  profileType: ProfileType;

  @Field(() => Date, { nullable: true })
  lastLoginDate: Date;

  @Field(() => [Form])
  forms: Form[];

  @Field(() => Date)
  createdAt: Date;
}