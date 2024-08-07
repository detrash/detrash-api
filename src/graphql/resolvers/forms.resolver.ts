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
import { DocumentsService } from '@/documents/documents.service';
import { FormsService } from '@/forms/forms.service';
import { UsersService } from '@/users/users.service';

import { Document } from '../entities/document.entity';
import { Form } from '../entities/form.entity';
import { CreateFormInput } from '../inputs/create-form-input';
import { ListFiltersInput } from '../inputs/list-filters-input';
import { AggregateFormByUserProfileResponse } from '../responses/aggregate-form-by-user-profile-response';
import { CreateFormResponse } from '../responses/create-form-response';
import { SubmitNFTResponse } from '../responses/submit-nft-response';

@Resolver(() => Form)
export class FormsResolver {
  constructor(
    private formsService: FormsService,
    private usersService: UsersService,
    private documentsService: DocumentsService,
  ) {}

  @Query(() => [Form])
  @Roles(Role.Admin)
  async forms(
    @Args('filter', { type: () => ListFiltersInput, nullable: true })
    filter: ListFiltersInput,
  ) {
    return this.formsService.listAllForms(filter);
  }

  @ResolveField()
  user(@Parent() form: Form) {
    return this.usersService.findUserByUserId(form.userId);
  }

  @ResolveField(() => [Document])
  documents(@Parent() form: Form) {
    return this.documentsService.listDocumentsFromForm(form.id);
  }

  @Query(() => [AggregateFormByUserProfileResponse])
  @Roles(Role.Admin)
  aggregateFormByUserProfile() {
    return this.formsService.aggregateFormByUserProfile();
  }

  @Query(() => Form)
  @Roles(Role.Admin)
  async form(@Args('formId') formId: string) {
    return this.formsService.findByFormId(formId);
  }

  @Mutation(() => CreateFormResponse)
  createForm(
    @Args('data') data: CreateFormInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.formsService.createForm({ authUserId: user.sub, ...data });
  }

  @Mutation(() => Form)
  @Roles(Role.Admin)
  authorizeForm(
    @Args('formId') formId: string,
    @Args('isFormAuthorized') isFormAuthorized: boolean,
  ) {
    return this.formsService.authorizeForm(formId, isFormAuthorized);
  }

  @Mutation(() => String)
  @Roles(Role.Admin)
  submitFormImage(@Args('formId') formId: string) {
    return this.formsService.submitFormImage(formId);
  }

  @Mutation(() => SubmitNFTResponse)
  @Roles(Role.Admin)
  createFormMetadata(@Args('formId') formId: string) {
    return this.formsService.createFormMetadata(formId);
  }
}
